import { notFound } from "next/navigation";

import { CardGrid, VideoCard } from "@/components/VideoCard";
import { one } from "@/lib/db";
import { CARD_COLUMNS, cards } from "@/lib/videos";
import { Composer } from "../composer";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상 찾기" };

export default async function FindResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await one<{ id: number; prompt: string; seed_video: string | null; corpus_size: number; candidates: number }>(
    "SELECT id, prompt, seed_video, corpus_size, candidates FROM finds WHERE id = $1",
    [Number(id)],
  );
  if (!f) notFound();

  const list = await cards(
    `SELECT ${CARD_COLUMNS} FROM find_hits h
       JOIN videos v ON v.video_id = h.video_id JOIN channels c ON c.channel_id = v.channel_id
      WHERE h.find_id = $1 ORDER BY h.rank`,
    [f.id],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <h1 className="text-[24px] font-bold tracking-tight">영상 찾기</h1>
        <div className="mx-auto mt-8 max-w-[960px]">
          <h2 className="text-[15px] font-semibold">
            {f.seed_video && <span className="text-sub">이 영상과 비슷한 영상 · </span>}
            {f.prompt}
          </h2>
          <p className="mb-3 mt-6 text-[12px] text-faint">
            검색 결과 · 영상 {f.corpus_size.toLocaleString()}개 중 후보 {f.candidates}개에서 {list.length}개
          </p>
          {list.length === 0 ? (
            <p className="rounded-xl bg-hover/5 px-4 py-10 text-center text-sm text-sub">
              요청에 맞으면서 채널 평소보다 잘 된 영상을 찾지 못했습니다. 조금 더 넓은 표현으로 다시 찾아 보세요.
            </p>
          ) : (
            <CardGrid cols={3}>
              {list.map((v, i) => (
                <VideoCard key={v.videoId} v={v} eager={i < 6} />
              ))}
            </CardGrid>
          )}
        </div>
      </div>
      <Composer compact />
    </div>
  );
}
