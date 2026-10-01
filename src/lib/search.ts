import { embed, hasGemini } from "@/lib/ai";
import { q, vec } from "@/lib/db";

/**
 * 영상 DB 에서 "이 주제로 잘 된 영상" 후보를 꺼낸다 — 영상 찾기와 아웃라이어 탭이 같이 쓴다.
 *
 * 두 갈래를 합친다:
 *   - 뜻 검색: 벡터가 붙은 영상 (Gemini 임베딩)
 *   - 단어 검색: 아직 벡터가 없는 영상 (AI 가 넓혀 준 검색어로 제목·설명을 훑는다)
 * Gemini 무료 임베딩은 분당 100편·하루 약 1,000편이라 DB 전체(수만 편)에 벡터를 다 붙일 수 없다.
 * 그래서 벡터는 검색 대상인 아웃라이어(2x 이상)에만 붙이고, 붙기 전까지는 단어 검색이 메운다.
 */

export interface Hit {
  video_id: string;
  title: string;
  title_ko: string | null;
  channel_title: string;
  ratio: number;
  description: string | null;
}

export interface SearchOpts {
  /** 요청 문장 + 정답 기준 + 검색어들 */
  texts: string[];
  /** 이미 있는 벡터 (비슷한 영상 찾기) */
  vector?: string | null;
  minRatio?: number;
  includeShorts?: boolean;
  limit?: number;
  /** 추가 조건 (v = videos 별칭) */
  where?: string;
  /** 사용자가 기다리는 요청이면 임베딩 한도에 걸려도 기다리지 않는다 */
  fast?: boolean;
}

export async function searchOutliers(o: SearchOpts): Promise<Hit[]> {
  const limit = o.limit ?? 100;
  const params: unknown[] = [o.minRatio ?? 2];
  const base = [
    "v.ratio >= $1",
    o.includeShorts ? "" : "v.format = 'long'",
    "v.channel_id NOT IN (SELECT channel_id FROM hidden_channels)",
    "v.video_id NOT IN (SELECT video_id FROM dismissed_videos)",
    o.where ?? "",
  ].filter(Boolean);

  // 1) 뜻 검색
  let semantic: Hit[] = [];
  let qv = o.vector ?? null;
  if (!qv && hasGemini()) {
    qv = await embed([o.texts.join("\n")], "query", { fast: o.fast })
      .then((r) => (r[0] ? vec(r[0]) : null))
      .catch(() => null);
  }
  if (qv) {
    semantic = await q<Hit>(
      `SELECT v.video_id, v.title, v.title_ko, c.title AS channel_title, v.ratio, v.description
         FROM videos v JOIN channels c ON c.channel_id = v.channel_id
        WHERE v.embedding IS NOT NULL AND ${base.join(" AND ")}
        ORDER BY v.embedding <=> $2::vector LIMIT ${limit}`,
      [...params, qv],
    );
  }

  // 2) 단어 검색 — 벡터가 아직 없는 영상까지 덮는다
  const words = [
    ...new Set(
      o.texts
        .join(" ")
        .split(/[\s,.·|!?()[\]"'“”‘’/]+/)
        .map((w) => w.replace(/(을|를|이|가|은|는|의|에|로|으로|하는|해야하는|하기|하면)$/, ""))
        .filter((w) => w.length >= 2),
    ),
  ].slice(0, 16);
  let lexical: Hit[] = [];
  if (words.length) {
    const score = words
      .map((_, i) => `(CASE WHEN v.title || ' ' || COALESCE(v.title_ko,'') ILIKE $${i + 2} THEN 2 ELSE 0 END
                     + CASE WHEN COALESCE(v.description,'') ILIKE $${i + 2} THEN 1 ELSE 0 END)`)
      .join(" + ");
    lexical = await q<Hit>(
      `SELECT video_id, title, title_ko, channel_title, ratio, description FROM (
         SELECT v.video_id, v.title, v.title_ko, c.title AS channel_title, v.ratio, v.description, (${score}) AS s
           FROM videos v JOIN channels c ON c.channel_id = v.channel_id
          WHERE ${base.join(" AND ")} ${qv ? "AND v.embedding IS NULL" : ""}) t
        WHERE s >= 2 ORDER BY s DESC, ratio DESC LIMIT ${limit}`,
      [...params, ...words.map((w) => `%${w}%`)],
    );
  }

  // 3) 번갈아 섞는다 (뜻 검색 우선) — 한쪽이 다른 쪽을 다 밀어내지 않게
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && (i < semantic.length || i < lexical.length); i++) {
    for (const h of [semantic[i], lexical[i]]) {
      if (h && !seen.has(h.video_id) && out.length < limit) {
        seen.add(h.video_id);
        out.push(h);
      }
    }
  }
  return out;
}
