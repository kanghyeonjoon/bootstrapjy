import { refreshCorpus } from "@/lib/corpus";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 매일 갱신 (Vercel Cron). 등록 채널부터 새 영상·조회수·기준 조회수를 다시 받는다.
 * ?force=1 이면 주기와 상관없이 폴더 채널을 지금 다시 긁는다 (수동 새로고침). force=all 은 전 채널.
 */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force");
  if (force === "1") await q("UPDATE channels SET crawled_at = NULL WHERE source = 'folder'");
  if (force === "all") await q("UPDATE channels SET crawled_at = NULL");
  const r = await refreshCorpus(240_000);
  return Response.json(r);
}
