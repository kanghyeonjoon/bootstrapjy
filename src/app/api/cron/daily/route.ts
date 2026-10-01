import { refreshCorpus } from "@/lib/corpus";
import { seedCorpus } from "@/lib/seed";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 매일 갱신 (Vercel Cron, 새벽 4시). 등록 채널의 새 영상·조회수를 다시 받고,
 * 남은 시간에 관심 주제로 영상 DB 를 미리 넓힌다 (영상 찾기가 빨라지는 이유).
 * ?force=1 이면 주기와 상관없이 폴더 채널을 지금 다시 긁는다 (수동 새로고침). force=all 은 전 채널.
 */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force");
  if (force === "1") await q("UPDATE channels SET crawled_at = NULL WHERE source = 'folder'");
  if (force === "all") await q("UPDATE channels SET crawled_at = NULL");
  // 1) 등록 채널 새 영상·조회수 갱신 → 2) 남은 시간에 관심 주제로 DB 넓히기
  const t0 = Date.now();
  const refreshed = await refreshCorpus(120_000);
  const seeded = await seedCorpus(Math.max(0, 250_000 - (Date.now() - t0)));
  return Response.json({ ...refreshed, ...seeded });
}
