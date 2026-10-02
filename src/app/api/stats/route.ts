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
            (SELECT COUNT(*)::int FROM patterns) AS patterns,
            (SELECT COUNT(*)::int FROM channels WHERE crawled_at > now() - interval '24 hours') AS channels_fresh_24h,
            (SELECT MIN(crawled_at)::text FROM channels WHERE source = 'folder') AS folder_oldest_crawl,
            (SELECT MAX(crawled_at)::text FROM channels) AS last_crawl,
            (SELECT MAX(published_at)::text FROM videos) AS newest_video,
            COUNT(*) FILTER (WHERE published_at > now() - interval '7 days')::int AS videos_last7d,
            COUNT(*) FILTER (WHERE published_at > now() - interval '7 days' AND ratio >= 2)::int AS outliers_last7d,
            COUNT(*) FILTER (WHERE rising >= 2)::int AS rising2,
            (SELECT COUNT(*)::int FROM channels WHERE rss_at > now() - interval '1 hour') AS rss_recent,
            (SELECT json_object_agg(COALESCE(fit::text,'null'), n) FROM (SELECT fit, COUNT(*)::int n FROM channels GROUP BY fit) x) AS fit
       FROM videos`,
  );
  return Response.json(r);
}
