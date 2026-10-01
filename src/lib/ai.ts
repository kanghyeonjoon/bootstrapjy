/**
 * AI 호출 한 곳.
 *
 * 기본은 **Gemini 무료 등급 하나로 전부** 한다 (키 하나, 카드 등록 없음, 0원):
 * - 글·판단 (검색어 만들기, 후보 고르기, 패턴, 핵심 주장, 번역): Gemini Flash
 * - 뜻 검색용 임베딩: Gemini Embedding
 * - 유튜브 영상 직접 읽기(자막 대신): Gemini Flash 에 영상 URL 을 그대로 넣는다.
 *   클라우드 서버에서 남의 영상 자막을 긁으면 막히는 일이 잦아서다.
 *
 * Claude 키(sk-ant-)를 넣으면 글·판단만 Claude 로 바뀐다 (유료, 선택 사항).
 *
 * 무료 등급의 조건: 보낸 내용이 구글 제품 개선에 쓰일 수 있다. 여기서 보내는 건
 * 공개된 유튜브 제목·영상이라 문제 되지 않는다. 대신 분당·일당 호출 한도가 있어서
 * 429(한도 초과)는 잠깐 쉬었다 다시 보낸다.
 */

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
/**
 * 모델은 "앞에서부터 시도하고, 붐비면(503)·한도면(429) 바로 다음 것"으로 넘어간다.
 * 2026-10 실측: 무료 등급 gemini-3.8-flash 는 붐벼서 503(6초 허비), 3.5-flash-lite 는 1.1초.
 * 하나만 고집하면 붐빌 때마다 몇십 초씩 기다리게 된다.
 */
const list = (env: string | undefined, fallback: string[]) => (env ? env.split(",").map((m) => m.trim()) : fallback);
/** 판단·글쓰기 (고르기, 패턴, 핵심 주장) */
const TEXT_MODELS = list(process.env.GEMINI_MODELS, ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]);
/** 번역·검색어처럼 단순하고 빠르면 되는 일 */
const LITE_MODELS = list(process.env.GEMINI_LITE_MODELS, ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash"]);
/** 유튜브 영상 직접 읽기 — 영상 이해는 큰 모델이 낫다 */
const VIDEO_MODELS = list(process.env.GEMINI_VIDEO_MODELS, ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"]);
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-2";
export const EMBED_DIM = 768;

// 키를 붙여 넣을 때 앞뒤 공백이 딸려 오는 일이 잦다 (2026-10 실제로 " AIza…" 때문에 400). 항상 다듬어 쓴다
const claudeKey = () => (process.env.ANTHROPIC_API_KEY ?? "").trim();
const geminiKey = () => (process.env.GEMINI_API_KEY ?? "").trim();

export const hasClaude = () => claudeKey().startsWith("sk-ant-");
export const hasGemini = () => geminiKey().length > 20;
/** 글·판단을 맡길 AI 가 하나라도 있는가 */
export const hasLLM = () => hasClaude() || hasGemini();

export class AiError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 응답에서 JSON 하나를 떼어 낸다. 앞뒤 설명이나 코드펜스가 붙어 와도 읽는다. */
export function parseJson<T>(text: string): T {
  const s = text.search(/[[{]/);
  const e = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (s < 0 || e <= s) throw new AiError(`JSON 이 아닌 응답: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(s, e + 1)) as T;
}

// ── 글·판단 ───────────────────────────────────────────────────

export interface LlmOpts {
  maxTokens?: number;
  /** JSON 만 받는다 */
  json?: boolean;
  /** 단순·대량 작업이면 가벼운 모델로 */
  lite?: boolean;
  /** 사용자가 기다리는 요청: 한도에 걸려도 길게 기다리지 않고 바로 실패한다 */
  fast?: boolean;
}

export async function llm(system: string, user: string, opts: LlmOpts = {}): Promise<string> {
  if (hasClaude()) return claude(system, user, opts.maxTokens ?? 4000);
  if (!hasGemini()) throw new AiError("AI 키가 없습니다. GEMINI_API_KEY 를 넣어 주세요 (무료).");

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: opts.maxTokens ?? 8000,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      // 고르기·번역 같은 일엔 길게 생각할 필요가 없다. 생각을 줄이면 몇 초씩 빨라진다
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
  return textOf(await generate(opts.lite ? LITE_MODELS : TEXT_MODELS, body, opts));
}

/**
 * 모델 목록을 앞에서부터 시도한다. 붐빔·한도면 기다리지 않고 다음 모델로 넘어가고,
 * 모델이 thinkingLevel 을 모르면(400) 그 설정만 빼고 같은 모델로 다시 보낸다.
 * 전부 막혔을 때만 (fast 가 아니면) 잠깐 쉬고 한 바퀴 더 돈다.
 */
async function generate(models: string[], body: Record<string, unknown>, opts: { fast?: boolean }): Promise<GenResponse> {
  const rounds = opts.fast ? 1 : 3;
  let last: Error | null = null;
  for (let round = 0; round < rounds; round++) {
    for (const m of models) {
      try {
        return await gemini<GenResponse>(`models/${m}:generateContent`, body, {
          noRetry: true,
          // 사용자가 기다리는 요청: 10초 안에 답이 없으면 그 모델은 붐비는 것으로 보고 다음으로
          timeoutMs: opts.fast ? 10_000 : 90_000,
        });
      } catch (e) {
        last = e as Error;
        if (/thinking/i.test(last.message)) {
          const gc = { ...(body.generationConfig as Record<string, unknown>) };
          delete gc.thinkingConfig;
          try {
            return await gemini<GenResponse>(`models/${m}:generateContent`, { ...body, generationConfig: gc }, { noRetry: true });
          } catch (e2) {
            last = e2 as Error;
          }
        }
        if (!(e instanceof BusyError) && !/thinking/i.test(last.message)) throw last;
      }
    }
    if (round < rounds - 1) await sleep(5000 * (round + 1));
  }
  throw last instanceof BusyError
    ? new AiError("Gemini 무료 모델이 지금 모두 붐비거나 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.")
    : (last ?? new AiError("Gemini 호출 실패"));
}

/** 붐빔(503)·한도(429) — 다른 모델로 넘어가면 되는 실패 */
class BusyError extends AiError {}

export async function llmJson<T>(system: string, user: string, opts: LlmOpts = {}): Promise<T> {
  return parseJson<T>(await llm(system, user, { ...opts, json: true }));
}

async function claude(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": claudeKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new AiError(`Claude 오류 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (body.content ?? []).map((b) => b.text ?? "").join("").trim();
}

// ── Gemini ────────────────────────────────────────────────────

const G = "https://generativelanguage.googleapis.com/v1beta";

interface GenResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
}

const textOf = (r: GenResponse) =>
  (r.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();

/**
 * 무료 등급 한도(429)·일시 오류(503)는 기다렸다가 다시 보낸다.
 * 뒤편 작업은 최대 4번·1분까지 기다리고, 사용자가 기다리는 요청(fast)은 2초 한 번만.
 */
async function gemini<T>(
  path: string,
  body: unknown,
  opts: { fast?: boolean; noRetry?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const maxAttempts = opts.noRetry ? 1 : opts.fast ? 2 : 4;
  if (!hasGemini()) throw new AiError("GEMINI_API_KEY 가 설정되지 않았습니다.");
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${G}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new BusyError(`Gemini 응답 지연 (${path.split("/")[1]?.split(":")[0]})`);
      throw e;
    }
    if (res.ok) return (await res.json()) as T;

    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts) {
      // 응답에 "retryDelay": "23s" 가 오면 그만큼, 아니면 점점 길게
      const hinted = /"retryDelay":\s*"(\d+)s"/.exec(text);
      await sleep(opts.fast ? 2000 : Math.min(60_000, hinted ? Number(hinted[1]) * 1000 + 500 : 4000 * attempt));
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      throw new BusyError(`Gemini ${res.status === 429 ? "한도 초과" : "붐빔"} (${path.split("/")[1]?.split(":")[0]})`);
    }
    throw new AiError(`Gemini 오류 (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * 문장들 → 768차원 벡터. 한 번 요청에 100개씩.
 * gemini-embedding-2 는 taskType 을 받지 않아서 용도를 글머리에 적는다.
 */
export async function embed(
  texts: string[],
  task: "document" | "query" = "document",
  opts: { fast?: boolean } = {},
): Promise<number[][]> {
  const v1 = EMBED_MODEL.includes("001");
  const prep = (t: string) =>
    v1 ? t : task === "query" ? `task: search result | query: ${t}` : `title: none | text: ${t}`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    const r = await gemini<{ embeddings?: Array<{ values: number[] }> }>(`models/${EMBED_MODEL}:batchEmbedContents`, {
      requests: chunk.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: prep(t.slice(0, 2000)) }] },
        outputDimensionality: EMBED_DIM,
        ...(v1 ? { taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" } : {}),
      })),
    }, opts);
    out.push(...(r.embeddings ?? []).map((e) => e.values));
  }
  return out;
}

/** 공개 유튜브 영상을 Gemini 가 직접 보고 답한다 */
export async function geminiOnVideo(videoId: string, prompt: string, opts: { json?: boolean } = {}): Promise<string> {
  const r = await generate(VIDEO_MODELS, {
    contents: [
      {
        parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } }, { text: prompt }],
      },
    ],
    generationConfig: { temperature: 0.2, ...(opts.json === false ? {} : { responseMimeType: "application/json" }) },
  }, {});
  return textOf(r);
}
