/**
 * AI 호출 두 갈래.
 *
 * - Claude: 검색어 만들기·후보 고르기·패턴·핵심 주장·번역 같은 "판단과 글".
 * - Gemini: 임베딩(뜻 검색)과 유튜브 영상 직접 읽기(자막 대신).
 *   클라우드 서버에서는 남의 영상 자막을 긁으면 자주 막히는데, Gemini 는 공개
 *   유튜브 URL 을 입력으로 받아서 그 문제를 비켜 간다.
 *
 * 키가 없으면 has*() 가 false 다. 호출하는 쪽이 단순 모드로 내려간다.
 */

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIM = 768;

export const hasClaude = () => (process.env.ANTHROPIC_API_KEY ?? "").startsWith("sk-ant-");
export const hasGemini = () => (process.env.GEMINI_API_KEY ?? "").length > 20;

export class AiError extends Error {}

export async function claude(system: string, user: string, maxTokens = 4000): Promise<string> {
  if (!hasClaude()) throw new AiError("ANTHROPIC_API_KEY(sk-ant-…)가 설정되지 않았습니다.");
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

/** 응답에서 JSON 하나를 떼어 낸다. 앞뒤 설명이나 코드펜스가 붙어 와도 읽는다. */
export function parseJson<T>(text: string): T {
  const s = text.search(/[[{]/);
  const e = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (s < 0 || e <= s) throw new AiError(`JSON 이 아닌 응답: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(s, e + 1)) as T;
}

export async function claudeJson<T>(system: string, user: string, maxTokens = 4000): Promise<T> {
  return parseJson<T>(await claude(system, user, maxTokens));
}

// ── Gemini ────────────────────────────────────────────────────

const G = "https://generativelanguage.googleapis.com/v1beta";

async function gemini<T>(path: string, body: unknown): Promise<T> {
  if (!hasGemini()) throw new AiError("GEMINI_API_KEY 가 설정되지 않았습니다.");
  const res = await fetch(`${G}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AiError(`Gemini 오류 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/**
 * 문장들 → 768차원 벡터. 한 번에 100개까지.
 * task 는 저장할 문서면 RETRIEVAL_DOCUMENT, 검색어면 RETRIEVAL_QUERY.
 */
export async function embed(
  texts: string[],
  task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT",
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    const r = await gemini<{ embeddings?: Array<{ values: number[] }> }>(
      `models/${EMBED_MODEL}:batchEmbedContents`,
      {
        requests: chunk.map((t) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: t.slice(0, 2000) }] },
          taskType: task,
          outputDimensionality: EMBED_DIM,
        })),
      },
    );
    out.push(...(r.embeddings ?? []).map((e) => e.values));
  }
  return out;
}

/** 공개 유튜브 영상을 Gemini 가 직접 보고 답한다. */
export async function geminiOnVideo(videoId: string, prompt: string): Promise<string> {
  const r = await gemini<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(
    `models/${GEMINI_MODEL}:generateContent`,
    {
      contents: [
        {
          parts: [
            { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0.2 },
    },
  );
  return (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}
