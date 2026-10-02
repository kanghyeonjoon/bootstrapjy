import { getKv } from "@/lib/db";
import { sweepRss } from "@/lib/rss";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** RSS 로 전 채널 새 영상·조회수 반영 (할당량 0). ?check=1 이면 마지막 실행 시각만 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("check")) return Response.json({ lastSweep: await getKv("rssSweepAt", null) });
  const t0 = Date.now();
  const r = await sweepRss(100_000);
  return Response.json({ ...r, seconds: Math.round((Date.now() - t0) / 1000) });
}
