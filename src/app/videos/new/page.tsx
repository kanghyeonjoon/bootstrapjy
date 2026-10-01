import { redirect } from "next/navigation";

import { one } from "@/lib/db";
import { Runner } from "./runner";

export const dynamic = "force-dynamic";
export const metadata = { title: "분석 준비" };

/** /videos/new?v=영상ID — 이미 분석한 영상이면 결과로, 아니면 분석을 시작한다 */
export default async function NewAnalysis({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  if (!v) redirect("/dashboard");
  const done = await one<{ id: number }>(
    "SELECT id FROM analyses WHERE video_id = $1 AND status = 'done' ORDER BY id DESC LIMIT 1",
    [v],
  );
  if (done) redirect(`/videos/${done.id}`);
  const video = await one<{ title: string; title_ko: string | null; thumbnail_url: string | null }>(
    "SELECT title, title_ko, thumbnail_url FROM videos WHERE video_id = $1",
    [v],
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-5 text-[24px] font-bold tracking-tight">분석 준비</h1>
      <Runner videoId={v} title={video?.title_ko ?? video?.title ?? ""} thumb={video?.thumbnail_url ?? null} />
    </div>
  );
}
