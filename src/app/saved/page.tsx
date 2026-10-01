import Link from "next/link";

import { CardGrid } from "@/components/VideoCard";
import { one, q } from "@/lib/db";
import { CARD_COLUMNS, cards } from "@/lib/videos";
import { NewTopic, SavedCard, TopicHeader } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "저장한 영상" };

export default async function Saved({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const sp = await searchParams;
  // 주제가 하나도 없으면 "기본"을 만든다
  if (!(await one("SELECT 1 FROM saved_topics"))) await q("INSERT INTO saved_topics (name) VALUES ('기본')");
  const topics = await q<{ id: number; name: string; n: number }>(
    `SELECT t.id, t.name, (SELECT COUNT(*)::int FROM saved_videos s WHERE s.topic_id = t.id) AS n
       FROM saved_topics t ORDER BY t.position, t.id`,
  );
  const topic = topics.find((t) => String(t.id) === sp.topic) ?? topics[0];
  const first = topic.id === topics[0].id;

  // 주제가 지워져 갈 곳 없는 영상은 첫 주제에 보인다
  const list = await cards(
    `SELECT ${CARD_COLUMNS}, s.reason FROM saved_videos s
       JOIN videos v ON v.video_id = s.video_id JOIN channels c ON c.channel_id = v.channel_id
      WHERE s.topic_id = $1 ${first ? "OR s.topic_id IS NULL" : ""}
      ORDER BY s.saved_at DESC`,
    [topic.id],
  );
  const reasons = new Map(
    (await q<{ video_id: string; reason: string | null }>("SELECT video_id, reason FROM saved_videos")).map((r) => [
      r.video_id,
      r.reason,
    ]),
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-5 text-[24px] font-bold tracking-tight">저장한 영상</h1>
      <div className="flex flex-wrap items-end gap-1">
        {topics.map((t) => (
          <Link
            key={t.id}
            href={`/saved?topic=${t.id}`}
            className={`rounded-t-xl border border-b-0 px-3.5 py-2 text-[13px] ${
              t.id === topic.id ? "border-line bg-card/60 font-semibold" : "border-transparent text-sub hover:text-ink"
            }`}
          >
            {t.name} <span className="text-[11px] text-faint">{t.n}</span>
          </Link>
        ))}
        <NewTopic />
      </div>
      <section className="rounded-b-2xl rounded-tr-2xl border border-line bg-card/60 p-4 md:p-5">
        <TopicHeader id={topic.id} name={topic.name} count={list.length} deletable={topics.length > 1} />
        {list.length === 0 ? (
          <div className="mt-4 rounded-xl border border-line px-4 py-12 text-center">
            <p className="text-sm font-semibold">저장한 영상이 없습니다.</p>
            <p className="mt-1 text-xs text-sub">대시보드 영상 카드의 저장 버튼으로 다시 보고 싶은 영상을 모아둘 수 있습니다.</p>
          </div>
        ) : (
          <div className="mt-4">
            <CardGrid>
              {list.map((v) => (
                <SavedCard key={v.videoId} v={v} reason={reasons.get(v.videoId) ?? ""} topics={topics} current={topic.id} />
              ))}
            </CardGrid>
          </div>
        )}
      </section>
    </div>
  );
}
