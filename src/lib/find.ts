import { embed, hasGemini, hasLLM, llmJson } from "@/lib/ai";
import { corpusSize, embedPending, ingestVideos, isKorean, translatePending } from "@/lib/corpus";
import { one, q, vec } from "@/lib/db";
import { searchVideos } from "@/lib/youtube";

/**
 * 영상 찾기 — Vidoutliers 와 같은 2단계.
 *
 *   1) 후보 찾기: 쌓아 둔 영상 DB 에서 요청과 뜻이 가까운 아웃라이어 99개
 *   2) 고르기:   Claude 가 그중 요청에 실제로 맞는 15개 안팎을 고른다
 *
 * 차이 하나: Vidoutliers 는 7만 편 DB 가 이미 있지만 우리는 혼자라 DB 가 작다.
 * 그래서 1) 전에 요청에서 만든 검색어로 유튜브를 한 번 훑어 DB 를 넓힌다(라이브 확장).
 * 찾을수록 DB 가 커지고, 다음 찾기는 더 넓은 곳에서 찾는다.
 */

export { FIND_STEPS } from "@/lib/find-steps";

export type FindEvent =
  | { type: "step"; step: number; detail?: string }
  | { type: "done"; findId: number }
  | { type: "error"; message: string };

/** Vidoutliers 결과는 전부 2.0x 이상이었다 */
const MIN_RATIO = 2;
const CANDIDATES = 99;
/** 라이브 확장 때 새로 긁을 채널 상한 (채널당 4유닛) */
const MAX_NEW_CHANNELS = 40;

const PLAN = `너는 유튜브 레퍼런스 영상을 찾는 리서처다. 사용자가 만들고 싶은 영상의 주제나 생각을 말한다.
같은 소재로 이미 잘 된 유튜브 영상을 찾기 위한 검색어를 만든다.

- ko: 한국 시청자가 유튜브 검색창에 칠 법한 짧은 한국어 검색어 4개 (2~5단어). 서로 다른 각도로 (직설 키워드 / 사례·인터뷰 / 방법·노하우 / 결과·숫자).
- en: 같은 소재의 영어권 인기 영상을 찾을 영어 검색어 1개.
- intent: "어떤 영상이 정답인지" 한 문장.
- 요청 문장을 그대로 복사하지 말고, 너무 넓은 한 단어도 피한다.

출력은 JSON 하나만: {"intent":"...","ko":["..."],"en":"..."}`;

const PICK = `너는 유튜브 레퍼런스 영상을 고르는 편집자다. 사용자 요청과, 뜻이 가까운 후보 영상 목록(배수 = 채널 평소 대비 조회수)을 받는다.
요청한 소재를 실제로 다루는 영상만 골라 관련도순으로 나열한다.

- 제목(필요하면 설명)으로 판단한다. 단어만 겹치고 소재가 다른 건 뺀다.
- 15개 안팎. 맞는 게 적으면 적게. 억지로 채우지 않는다.
- 같은 채널은 3편까지만.

출력은 JSON 하나만: {"ids":["영상ID", ...]}`;

interface Candidate {
  video_id: string;
  title: string;
  title_ko: string | null;
  channel_title: string;
  ratio: number;
  description: string | null;
}

export async function runFind(
  input: { prompt?: string; similar?: string; includeShorts?: boolean },
  emit: (e: FindEvent) => void,
): Promise<number> {
  // 0. 요청 확인
  emit({ type: "step", step: 0 });
  let prompt = (input.prompt ?? "").trim().slice(0, 300);
  let seedEmbedding: string | null = null;
  if (input.similar) {
    const seed = await one<{ title: string; title_ko: string | null; embedding: string | null }>(
      "SELECT title, title_ko, embedding::text FROM videos WHERE video_id = $1",
      [input.similar],
    );
    if (!seed) throw new Error("기준 영상을 찾을 수 없습니다.");
    prompt = seed.title_ko ?? seed.title;
    seedEmbedding = seed.embedding;
  }
  if (prompt.length < 2) throw new Error("찾을 주제를 조금 더 적어 주세요.");

  const [{ id: findId }] = await q<{ id: number }>(
    "INSERT INTO finds (prompt, seed_video) VALUES ($1, $2) RETURNING id",
    [prompt, input.similar ?? null],
  );

  try {
    // 1. 요청 방향 파악
    emit({ type: "step", step: 1, detail: hasLLM() ? undefined : "AI 키가 없어 단순 모드로 진행" });
    const plan = hasLLM()
      ? await llmJson<{ intent: string; ko: string[]; en?: string }>(PLAN, prompt, { maxTokens: 1000 })
      : { intent: prompt, ko: [prompt.slice(0, 60)], en: undefined };
    const queries = [...new Set([...(plan.ko ?? []).slice(0, 4), ...(plan.en ? [plan.en] : [])])];
    await q("UPDATE finds SET intent = $2, queries = $3 WHERE id = $1", [findId, plan.intent, JSON.stringify(queries)]);

    // 2. 검색 준비 — 유튜브를 훑어 DB 를 넓힌다
    emit({ type: "step", step: 2, detail: queries.join(" · ") });
    const found = (
      await Promise.all(
        queries.map((qq) =>
          searchVideos(qq, isKorean(qq) ? { lang: "ko", region: "KR" } : { lang: "en" }).catch(() => []),
        ),
      )
    ).flat();
    await ingestVideos(found, { maxNewChannels: MAX_NEW_CHANNELS });
    await translatePending(120).catch(() => 0);
    await embedPending(800).catch(() => 0);

    // 3. 영상 후보 찾기
    const total = await corpusSize();
    emit({ type: "step", step: 3, detail: `영상 ${total.toLocaleString()}개 중에서 찾는 중` });
    const cands = await candidates(prompt, queries, seedEmbedding, input);
    await q("UPDATE finds SET corpus_size = $2, candidates = $3 WHERE id = $1", [findId, total, cands.length]);
    emit({ type: "step", step: 3, detail: `영상 ${total.toLocaleString()}개 중 ${cands.length}개 찾음` });

    // 4. 요청에 맞는 영상 고르기
    emit({ type: "step", step: 4, detail: `${cands.length}개 중에서 고르는 중` });
    let ids: string[];
    if (hasLLM() && cands.length) {
      const list = cands
        .map((c) => `${c.video_id} | ${c.ratio.toFixed(1)}x | ${c.channel_title} | ${c.title_ko ?? c.title} | ${(c.description ?? "").replace(/\s+/g, " ").slice(0, 100)}`)
        .join("\n");
      const out = await llmJson<{ ids: string[] }>(PICK, `요청: ${prompt}\n정답 기준: ${plan.intent}\n\n${list}`, { maxTokens: 2000 });
      const known = new Set(cands.map((c) => c.video_id));
      ids = [...new Set(out.ids ?? [])].filter((id) => known.has(id) && id !== input.similar);
    } else {
      ids = cands.filter((c) => c.video_id !== input.similar).slice(0, 15).map((c) => c.video_id);
    }

    // 5. 결과 정리
    emit({ type: "step", step: 5 });
    for (const [i, id] of ids.entries()) {
      await q("INSERT INTO find_hits (find_id, rank, video_id) VALUES ($1,$2,$3)", [findId, i + 1, id]);
    }
    await q("UPDATE finds SET status = 'done' WHERE id = $1", [findId]);
    return findId;
  } catch (e) {
    await q("UPDATE finds SET status = 'error', error = $2 WHERE id = $1", [findId, (e as Error).message]);
    throw e;
  }
}

/** 뜻 검색(임베딩) — 키가 없으면 단어 겹침으로 대신한다 */
async function candidates(
  prompt: string,
  queries: string[],
  seedEmbedding: string | null,
  input: { includeShorts?: boolean; similar?: string },
): Promise<Candidate[]> {
  const fmt = input.includeShorts ? "" : "AND v.format = 'long'";
  const hidden = "AND v.channel_id NOT IN (SELECT channel_id FROM hidden_channels)";

  if (hasGemini()) {
    const qv = seedEmbedding ?? vec((await embed([[prompt, ...queries].join("\n")], "query"))[0]);
    return q<Candidate>(
      `SELECT v.video_id, v.title, v.title_ko, c.title AS channel_title, v.ratio, v.description
         FROM videos v JOIN channels c ON c.channel_id = v.channel_id
        WHERE v.embedding IS NOT NULL AND v.ratio >= $2 ${fmt} ${hidden}
        ORDER BY v.embedding <=> $1::vector LIMIT ${CANDIDATES}`,
      [qv, MIN_RATIO],
    );
  }

  // 단순 모드: 요청·검색어의 단어가 제목·설명에 몇 개 걸리는지로 줄 세운다
  const words = [...new Set([prompt, ...queries].join(" ").split(/[\s,.·|]+/).filter((w) => w.length >= 2))].slice(0, 12);
  if (!words.length) return [];
  const score = words.map((_, i) => `(CASE WHEN v.title || ' ' || COALESCE(v.title_ko,'') || ' ' || COALESCE(v.description,'') ILIKE $${i + 2} THEN 1 ELSE 0 END)`).join(" + ");
  return q<Candidate>(
    `SELECT * FROM (
       SELECT v.video_id, v.title, v.title_ko, c.title AS channel_title, v.ratio, v.description, (${score}) AS s
         FROM videos v JOIN channels c ON c.channel_id = v.channel_id
        WHERE v.ratio >= $1 ${fmt} ${hidden}) t
      WHERE s > 0 ORDER BY s DESC, ratio DESC LIMIT ${CANDIDATES}`,
    [MIN_RATIO, ...words.map((w) => `%${w}%`)],
  );
}

