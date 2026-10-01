import { CardGrid, VideoCard } from "@/components/VideoCard";
import { crawlChannel, upsertChannels } from "@/lib/corpus";
import { getKv, one, q } from "@/lib/db";
import { compact } from "@/lib/format";
import { CARD_COLUMNS, cards } from "@/lib/videos";
import { channelsByIds } from "@/lib/youtube";
import type { DashParams } from "../dashboard/page";
import { Avatar, ChangeMyChannel, FolderTabs, MyChannelBar } from "../dashboard/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "내 채널" };

interface MyCh {
  channel_id: string;
  title: string;
  avatar_url: string | null;
  subs: string | null;
  crawled_at: Date | null;
}
const SELECT = "SELECT channel_id, title, avatar_url, subs::text, crawled_at FROM channels WHERE channel_id = $1";

/**
 * 대시보드의 "내 채널" 탭 — 내 유튜브 채널 하나를 같은 방식(배수·필터)으로 본다.
 * 처음엔 .env 의 MY_CHANNEL_ID(기존 대시보드에 연결된 채널)를 쓰고, [변경]으로 바꾼다.
 */
export default async function MyChannel({ searchParams }: { searchParams: Promise<DashParams> }) {
  const sp = await searchParams;
  const folders = await q<{ id: number; name: string; n: number }>(
    `SELECT f.id, f.name, (SELECT COUNT(*)::int FROM folder_channels fc WHERE fc.folder_id = f.id) AS n
       FROM folders f ORDER BY f.position, f.id`,
  );

  const id = await getKv<string | null>("myChannel", process.env.MY_CHANNEL_ID ?? null);
  let ch = id ? await one<MyCh>(SELECT, [id]) : null;
  // 처음 열 때 한 번 긁어 온다
  if (id && !ch?.crawled_at) {
    if (!ch) await upsertChannels(await channelsByIds([id]), "folder");
    await crawlChannel(id);
    ch = await one<MyCh>(SELECT, [id]);
  }

  const format = sp.format ?? "long";
  const latest = sp.sort === "latest";
  const mult = Number(sp.multiplier ?? 1.5);
  const period = Number(sp.period ?? 3);
  const list = ch
    ? await cards(
        `SELECT ${CARD_COLUMNS} FROM videos v JOIN channels c ON c.channel_id = v.channel_id
          WHERE v.channel_id = $1 AND v.format = $2
            AND v.published_at >= now() - ($3 || ' months')::interval
            AND ($5 OR v.ratio >= $4)
          ORDER BY ${latest ? "v.published_at DESC" : "v.ratio DESC NULLS LAST"} LIMIT 60`,
        [ch.channel_id, format, String(period), mult, latest || mult === 0],
      )
    : [];

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-5 text-[24px] font-bold tracking-tight">대시보드</h1>
      <FolderTabs folders={folders} active={-1} mine />
      <section className="rounded-b-2xl rounded-tr-2xl border border-line bg-card/60 p-4 md:p-5">
        <div className="flex items-center gap-3 border-b border-line pb-3">
          {ch && <Avatar src={ch.avatar_url} name={ch.title} size={28} />}
          <p className="text-[13px]">
            <b>{ch?.title ?? "내 채널 미지정"}</b>
            {ch && <span className="text-faint"> · 구독자 {compact(ch.subs === null ? null : Number(ch.subs))}</span>}
          </p>
          <ChangeMyChannel />
        </div>
        <MyChannelBar format={format} sort={latest ? "latest" : "outlier"} sp={sp} />
        {list.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium">아직 표시할 outlier 영상이 없습니다.</p>
            <p className="mt-1 text-xs text-sub">필터의 기간이나 배수를 낮춰보세요.</p>
          </div>
        ) : (
          <div className="mt-4">
            <CardGrid>
              {list.map((v) => (
                <VideoCard key={v.videoId} v={v} />
              ))}
            </CardGrid>
          </div>
        )}
      </section>
    </div>
  );
}
