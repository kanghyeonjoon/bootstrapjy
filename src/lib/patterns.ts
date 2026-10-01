import { claudeJson, hasClaude } from "@/lib/ai";
import { q } from "@/lib/db";

/**
 * 패턴 분석 — 폴더의 최근 1년 아웃라이어에서 반복되는 주제를 뽑는다.
 *
 * Vidoutliers 결과 예: "미주신경과 신경계를 회복해 불안·불면과 삶의 문제를 개선하는 방법",
 * "호흡법을 활용한 명상 루틴". 즉 "무엇을 해서 어떤 결과를 얻는 방법" 꼴의 주제 묶음이다.
 * 이 패턴들이 아웃라이어 탭의 검색 기준이 된다.
 */

const SYSTEM = `너는 유튜브 기획 분석가다. 한 폴더(같은 분야 레퍼런스 채널 묶음)에서 채널 평균보다 크게 잘 된 영상 목록을 받는다.
이 영상들에서 반복되는 "잘 되는 주제 패턴"을 3~6개 뽑는다.

규칙:
- 패턴 이름은 한국어 한 문장, 25~45자. "무엇을 통해 어떤 결과를 얻는 방법/원리/이유" 처럼 시청자가 얻는 것이 드러나게.
  예: "미주신경과 신경계를 회복해 불안·불면을 개선하는 방법", "무의식을 바꾸고 원하는 현실을 만드는 원리"
- 영상 2편 이상이 공유하는 주제만 패턴이 된다. 한 편짜리는 버린다.
- 패턴마다 그 패턴에 속하는 영상 id 를 배수 높은 순으로 넣는다. 한 영상은 한 패턴에만.
- 영상이 많이 묶이는 패턴을 앞에 둔다.

출력은 JSON 하나만: {"patterns": [{"label": "...", "ids": ["영상ID", ...]}]}`;

export async function runPatterns(folderId: number, format: "long" | "short"): Promise<number> {
  if (!hasClaude()) throw new Error("패턴 분석에는 ANTHROPIC_API_KEY 가 필요합니다.");

  const rows = await q<{ video_id: string; title: string; title_ko: string | null; ratio: number }>(
    `SELECT v.video_id, v.title, v.title_ko, v.ratio
       FROM videos v JOIN folder_channels fc ON fc.channel_id = v.channel_id
      WHERE fc.folder_id = $1 AND v.format = $2 AND v.ratio >= 1.5
        AND v.published_at >= now() - interval '1 year'
      ORDER BY v.ratio DESC LIMIT 120`,
    [folderId, format],
  );
  if (rows.length < 4) throw new Error("패턴을 찾기엔 아웃라이어 영상이 너무 적습니다. 채널을 더 추가해 보세요.");

  const list = rows.map((r) => `${r.video_id} | ${r.ratio.toFixed(1)}x | ${r.title_ko ?? r.title}`).join("\n");
  const out = await claudeJson<{ patterns?: Array<{ label: string; ids: string[] }> }>(SYSTEM, list, 4000);
  const known = new Set(rows.map((r) => r.video_id));

  await q("DELETE FROM patterns WHERE folder_id = $1 AND format = $2", [folderId, format]);
  let pos = 0;
  for (const p of out.patterns ?? []) {
    const ids = p.ids.filter((id) => known.has(id));
    if (ids.length < 2) continue;
    const [{ id }] = await q<{ id: number }>(
      "INSERT INTO patterns (folder_id, format, label, position) VALUES ($1,$2,$3,$4) RETURNING id",
      [folderId, format, p.label, pos++],
    );
    for (const vid of ids) {
      await q("INSERT INTO pattern_videos (pattern_id, video_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, vid]);
    }
  }
  return pos;
}
