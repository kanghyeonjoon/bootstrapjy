import { hasLLM, llmJson } from "@/lib/ai";
import { corpusSize, embedPending, ingestVideos, isKorean, translatePending } from "@/lib/corpus";
import { one, q } from "@/lib/db";
import { searchOutliers } from "@/lib/search";
import { searchVideos } from "@/lib/youtube";

/**
 * 영상 찾기 — "미리 쌓아 둔 DB 에서 꺼내고 고르기만" 한다.
 *
 * Vidoutliers 실측 (2026-10-02, "호흡명상을 해야하는 이유"): 전체 약 14초.
 *   요청 방향 파악·검색 준비 ~8초 → "영상 75,492개 중 100개 찾음"(즉시) → 고르기 ~4초.
 * 빠른 이유는 DB 가 이미 있어서다. 요청 순간에 유튜브를 뒤지지 않는다.
 *
 * 처음엔 요청 순간에 유튜브 검색 + 새 채널 40개 크롤링 + 임베딩 800개를 다 했는데,
 * 그래서 몇 분씩 걸렸다. 지금은:
 *   요청 경로: 방향 파악(AI 1회) → 검색어를 벡터로(1회) → DB 에서 100개 → AI 가 고르기(1회)
 *   응답 뒤:   같은 검색어로 유튜브를 훑어 DB 를 넓힌다 (expandForQueries, 기다리지 않음)
 * 찾을수록 DB 가 커지고, 같은 계열을 다시 찾으면 더 많이 나온다.
 */

export { FIND_STEPS } from "@/lib/find-steps";

export type FindEvent =
  | { type: "step"; step: number; detail?: string }
  | { type: "done"; findId: number }
  | { type: "error"; message: string };

/** Vidoutliers 결과는 전부 2.0x 이상이었다 */
const MIN_RATIO = 2;
const CANDIDATES = 100;
/** 결과가 이보다 적으면 가까운 순 후보로 채운다 */
const MIN_RESULTS = 10;
/** 조회수가 너무 적은 영상은 배수만 커 보인다 */
const MIN_VIEWS = 3000;

const PLAN = `너는 유튜브 레퍼런스 영상을 찾는 리서처다. 사용자는 영상을 기획 중이고, 하고 싶은 말(주장·메시지)을 대략 적는다.
그 말과 "비슷한 이야기를 해서 이미 잘 된 영상"을 찾는 게 목적이다. 제목·썸네일 문구를 참고하려는 것이다.

- intent: 사용자가 하려는 핵심 주장을 한 문장으로 (예: "불안은 마음보다 몸(자율신경)부터 진정시켜야 풀린다").
- ko: 그런 주장을 담은 영상이 쓸 법한 한국어 유튜브 검색어 4개 (2~5단어, 서로 다른 각도).
- en: 같은 이야기를 하는 영어권 영상을 찾을 영어 검색어 3개 (서로 다른 각도, 영어권 유튜버가 실제로 쓸 법한 표현).

출력은 JSON 하나만: {"intent":"...","ko":["..."],"en":["...","...","..."]}`;

/** 고르는 기준: 같은 주제가 아니라 "같은 이야기를 하는가" */
export const PICK = `너는 유튜브 레퍼런스 영상을 고르는 편집자다. 사용자는 영상을 기획 중이고, 자기가 하려는 말과 비슷한 이야기를 해서 잘 된 영상을 찾아 제목·썸네일 문구를 참고하려 한다.
후보 영상 목록(배수 = 채널 평소 대비 조회수)에서 골라 관련도순으로 나열한다.

- 사용자의 핵심 주장과 같은 이야기(같은 메시지·같은 결론·같은 해법)를 하는 영상을 맨 앞에.
- 그다음, 같은 시청자의 같은 고민을 다른 각도로 풀지만 메시지가 가까운 영상.
- 주제 단어만 겹치고 하는 말이 다른 영상은 뺀다.
- 최소 10개, 최대 15개를 고른다. 후보가 10개 이상이면 반드시 10개 이상을 채운다 — 앞쪽은 엄격하게, 뒤쪽은 같은 시청자에게 도움이 되는 비슷한 메시지로 넓혀 채운다. 후보 자체가 10개 미만일 때만 그보다 적게. 같은 채널은 3편까지만.

출력은 JSON 하나만: {"ids":["영상ID", ...]}`;

export interface FindResult {
  findId: number;
  /** 응답 뒤 DB 확장에 쓸 검색어 */
  queries: string[];
}

export async function runFind(
  input: { prompt?: string; similar?: string; includeShorts?: boolean },
  emit: (e: FindEvent) => void,
): Promise<FindResult> {
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
    // 1. 요청 방향 파악 — 비슷한 영상 찾기는 기준 영상이 곧 방향이라 건너뛴다
    emit({ type: "step", step: 1, detail: hasLLM() ? undefined : "AI 키가 없어 단순 모드로 진행" });
    let plan = { intent: prompt, ko: [prompt.slice(0, 60)], en: undefined as string[] | string | undefined };
    if (hasLLM()) {
      plan = await llmJson<typeof plan>(PLAN, prompt, { maxTokens: 600, lite: true, fast: true }).catch(() => plan);
    }
    const en = Array.isArray(plan.en) ? plan.en.slice(0, 3) : plan.en ? [plan.en] : [];
    const queries = [...new Set([...(plan.ko ?? []).slice(0, 4), ...en])];
    await q("UPDATE finds SET intent = $2, queries = $3 WHERE id = $1", [findId, plan.intent, JSON.stringify(queries)]);

    // 2. 검색 준비 · 3. 영상 후보 찾기 — DB 에서 꺼내기만 한다 (뜻 검색 + 단어 검색)
    emit({ type: "step", step: 2 });
    const total = await corpusSize();
    const cands = await searchOutliers({
      texts: [prompt, plan.intent, ...queries],
      vector: seedEmbedding,
      minRatio: MIN_RATIO,
      includeShorts: input.includeShorts,
      limit: CANDIDATES,
      // 결이 확실히 다른 채널(0점)은 뺀다. 아직 안 본 채널은 둔다
      where: `COALESCE(c.fit, 1) > 0 AND v.view_count >= ${MIN_VIEWS}`,
      fast: true,
    });
    await q("UPDATE finds SET corpus_size = $2, candidates = $3 WHERE id = $1", [findId, total, cands.length]);
    emit({ type: "step", step: 3, detail: `영상 ${total.toLocaleString()}개 중 ${cands.length}개 찾음` });

    // 4. 요청에 맞는 영상 고르기 — AI 가 막히면(무료 한도 등) 기다리지 않고 가까운 순으로
    emit({ type: "step", step: 4, detail: `${cands.length}개 중에서 고르는 중` });
    const pool = cands.filter((c) => c.video_id !== input.similar);
    let ids = pool.slice(0, 15).map((c) => c.video_id);
    if (hasLLM() && pool.length) {
      const list = pool
        .map(
          (c) =>
            `${c.video_id} | ${(c.ratio ?? 0).toFixed(1)}x | ${c.channel_title} | ${c.title_ko ?? c.title} | ${(c.description ?? "").replace(/\s+/g, " ").slice(0, 80)}`,
        )
        .join("\n");
      try {
        const out = await llmJson<{ ids: string[] }>(PICK, `하려는 말: ${prompt}\n핵심 주장: ${plan.intent}\n\n${list}`, {
          maxTokens: 1200,
          lite: true,
          fast: true,
        });
        const known = new Set(pool.map((c) => c.video_id));
        ids = [...new Set(out.ids ?? [])].filter((id) => known.has(id)).slice(0, 15);
        // AI 가 너무 깐깐하면 가까운 순 후보로 10개까지 채운다 (뒤쪽이라 순위는 밀린다)
        if (ids.length < MIN_RESULTS) {
          const strict = ids.length;
          const have = new Set(ids);
          for (const c of pool) {
            if (ids.length >= MIN_RESULTS) break;
            if (!have.has(c.video_id)) ids.push(c.video_id);
          }
          // 채워 넣은 영상만 한 번 더 걸러, 하려는 말과 무관하거나 시청자가 다른 영상을 뺀다
          const filler = ids.slice(strict);
          if (filler.length) {
            try {
              const byId = new Map(pool.map((c) => [c.video_id, c]));
              const rows = filler.map((id) => `${id} | ${byId.get(id)?.channel_title} | ${byId.get(id)?.title_ko ?? byId.get(id)?.title}`).join("\n");
              const chk = await llmJson<{ drop: string[] }>(
                '너는 유튜브 레퍼런스 영상을 검수하는 편집자다. 사용자가 하려는 말과 무관하거나, 시청자가 다르거나(예: 사업가가 아닌 일반 시청자용 자기계발·경제 일반), 주제만 걸친 영상의 id를 골라낸다. JSON 하나만: {"drop":["영상ID", ...]}',
                `하려는 말: ${prompt}\n핵심 주장: ${plan.intent}\n\n${rows}`,
                { maxTokens: 400, lite: true, fast: true },
              );
              const drop = new Set(chk.drop ?? []);
              ids = ids.filter((id) => !drop.has(id) || !filler.includes(id));
            } catch {
              // 검수가 실패하면 채운 그대로 낸다
            }
          }
        }
      } catch {
        // 고르기가 실패해도 결과는 낸다 (뜻이 가까운 순)
      }
    }

    // 5. 결과 정리
    emit({ type: "step", step: 5 });
    if (ids.length) {
      await q(
        `INSERT INTO find_hits (find_id, rank, video_id)
         SELECT $1, r.ord, r.id FROM unnest($2::text[]) WITH ORDINALITY AS r(id, ord)`,
        [findId, ids],
      );
    }
    await q("UPDATE finds SET status = 'done' WHERE id = $1", [findId]);
    return { findId, queries };
  } catch (e) {
    await q("UPDATE finds SET status = 'error', error = $2 WHERE id = $1", [findId, (e as Error).message]);
    throw e;
  }
}

/**
 * 응답을 돌려준 뒤에 도는 DB 확장. 사용자는 기다리지 않는다.
 * 같은 검색어로 유튜브를 훑어 새 채널을 들이고, 번역·임베딩까지 해 둔다.
 * 유튜브 할당량: 검색어 5개 × 101 + 새 채널 최대 25 × 4 ≈ 600유닛.
 */
export async function expandForQueries(queries: string[]): Promise<void> {
  if (!queries.length) return;
  const found = (
    await Promise.all(
      queries.map((s) => searchVideos(s, isKorean(s) ? { lang: "ko", region: "KR" } : { lang: "en" }).catch(() => [])),
    )
  ).flat();
  await ingestVideos(found, { maxNewChannels: 25 });
  await translatePending(150).catch(() => 0);
  await embedPending(270, 150_000).catch(() => 0);
}
