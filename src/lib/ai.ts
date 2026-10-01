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
/** 판단·글쓰기·영상 읽기 */
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
/** 번역처럼 단순하고 양이 많은 일 (무료 한도가 더 넉넉한 가벼운 모델) */
const GEMINI_LITE = process.env.GEMINI_LITE_MODEL ?? "gemini-3.5-flash-lite";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-2";
export const EMBED_DIM = 768;

export const hasClaude = () => (process.env.ANTHROPIC_API_KEY ?? "").startsWith("sk-ant-");
export const hasGemini = () => (process.env.GEMINI_API_KEY ?? "").length > 20;
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
}

export async function llm(system: string, user: string, opts: LlmOpts = {}): Promise<string> {
  if (hasClaude()) return claude(system, user, opts.maxTokens ?? 4000);
  if (!hasGemini()) throw new AiError("AI 키가 없습니다. GEMINI_API_KEY 를 넣어 주세요 (무료).");

  const r = await gemini<GenResponse>(`models/${opts.lite ? GEMINI_LITE : GEMINI_MODEL}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: opts.maxTokens ?? 8000,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return textOf(r);
}

export async function llmJson<T>(system: string, user: string, opts: LlmOpts = {}): Promise<T> {
  return parseJson<T>(await llm(system, user, { ...opts, json: true }));
}

async function claude(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
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

/** 무료 등급 한도(429)·일시 오류(503)는 기다렸다가 최대 4번까지 다시 보낸다 */
async function gemini<T>(path: string, body: unknown): Promise<T> {
  if (!hasGemini()) throw new AiError("GEMINI_API_KEY 가 설정되지 않았습니다.");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${G}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;

    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      // 응답에 "retryDelay": "23s" 가 오면 그만큼, 아니면 점점 길게
      const hinted = /"retryDelay":\s*"(\d+)s"/.exec(text);
      await sleep(Math.min(60_000, hinted ? Number(hinted[1]) * 1000 + 500 : 4000 * attempt));
      continue;
    }
    if (res.status === 429) {
      throw new AiError("Gemini 무료 사용량을 다 썼습니다. 잠시 뒤(또는 내일) 다시 시도해 주세요.");
    }
    throw new AiError(`Gemini 오류 (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * 문장들 → 768차원 벡터. 한 번 요청에 100개씩.
 * gemini-embedding-2 는 taskType 을 받지 않아서 용도를 글머리에 적는다.
 */
export async function embed(texts: string[], task: "document" | "query" = "document"): Promise<number[][]> {
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
    });
    out.push(...(r.embeddings ?? []).map((e) => e.values));
  }
  return out;
}

/** 공개 유튜브 영상을 Gemini 가 직접 보고 답한다 */
export async function geminiOnVideo(videoId: string, prompt: string, opts: { json?: boolean } = {}): Promise<string> {
  const r = await gemini<GenResponse>(`models/${GEMINI_MODEL}:generateContent`, {
    contents: [
      {
        parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } }, { text: prompt }],
      },
    ],
    generationConfig: { temperature: 0.2, ...(opts.json === false ? {} : { responseMimeType: "application/json" }) },
  });
  return textOf(r);
}
