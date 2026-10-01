import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 영상 DB 상태 한눈에 — 몇 편이 검색 대상(아웃라이어)이고 그중 몇 편이 뜻 검색 준비가 됐나 */
export async function GET() {
  const r = await one(
    `SELECT COUNT(*)::int AS videos,
            COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
            COUNT(*) FILTER (WHERE ratio >= 1.5)::int AS ratio15,
            COUNT(*) FILTER (WHERE ratio >= 2 AND format = 'long')::int AS outliers_long,
            COUNT(*) FILTER (WHERE ratio >= 1.5 AND embedding IS NULL)::int AS pending,
            (SELECT COUNT(*)::int FROM channels) AS channels,
            (SELECT COUNT(*)::int FROM outlier_feed) AS feed,
            (SELECT COUNT(*)::int FROM patterns) AS patterns
       FROM videos`,
  );
  return Response.json(r);
}
