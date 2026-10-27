import { CardGrid, VideoCard } from "@/components/VideoCard";
import { getKv, q } from "@/lib/db";
import { since } from "@/lib/format";
import { setFolders } from "@/lib/outliers";
import { listSets, pickSet } from "@/lib/sets";
import { CARD_COLUMNS, cards } from "@/lib/videos";
import { SetSwitcher } from "@/app/dashboard/ui";
import { AutoPick, OutlierToolbar } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "아웃라이어" };

export interface OutlierParams {
  set?: string;
  sort?: "recent" | "ratio" | "views";
  q?: string;
  multiplier?: string;
  /** 게시 시기 (개월). 13 이상이면 전체 */
  months?: string;
  page?: string;
}

const PAGE = 48;

export default async function Outliers({ searchParams }: { searchParams: Promise<OutlierParams> }) {
  const sp = await searchParams;
  const sets = await listSets();
  const set = pickSet(sets, sp.set);
  if (!set) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1100px]">
          <h1 className="text-[24px] font-bold tracking-tight">아웃라이어</h1>
          <p className="mt-10 text-center text-sm text-sub">
            아직 세트가 없습니다. 대시보드에서 세트를 먼저 만들어 주세요.
          </p>
        </div>
      </div>
    );
  }
  const sort = sp.sort ?? "recent";
  const mult = Number(sp.multiplier ?? 0);
  const months = Number(sp.months ?? 13);
  const page = Math.max(1, Number(sp.page ?? 1));

  const where = [
    "v.video_id NOT IN (SELECT video_id FROM dismissed_videos)",
    "v.channel_id NOT IN (SELECT channel_id FROM hidden_channels)",
  ];
  const params: unknown[] = [];
  if (mult > 0) {
    params.push(mult);
    where.push(`v.ratio >= $${params.length}`);
  }
  if (months <= 12) {
    params.push(String(months));
    where.push(`v.published_at >= now() - ($${params.length} || ' months')::interval`);
  }
  if (sp.q?.trim()) {
    params.push(`%${sp.q.trim()}%`);
    where.push(`(v.title ILIKE $${params.length} OR v.title_ko ILIKE $${params.length})`);
  }
  const order = { recent: "o.added_at DESC, v.ratio DESC", ratio: "v.ratio DESC", views: "v.view_count DESC" }[sort];

  const list = await cards(
    `SELECT ${CARD_COLUMNS} FROM set_outlier_feed o
       JOIN videos v ON v.video_id = o.video_id JOIN channels c ON c.channel_id = v.channel_id
      WHERE o.set_id = ${set.id} AND ${where.join(" AND ")} ORDER BY ${order} LIMIT ${PAGE * page + 1}`,
    params,
  );

  const connected = await setFolders(set.id);
  const refreshed = await getKv<string | null>(`outliersRefreshedAt:${set.id}`, null);
  const feedEmpty = !(await q("SELECT 1 FROM set_outlier_feed WHERE set_id = $1 LIMIT 1", [set.id])).length;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1100px]">
        <OutlierToolbar sp={sp} setId={set.id} switcher={<SetSwitcher sets={sets} active={set.id} base="/outliers" />} />
        <p className="mt-2 text-[11.5px] text-faint">
          {refreshed ? `${since(refreshed)} 갱신 · ` : ""}
          {set.name} 세트의 레퍼런스 폴더 패턴과 내 채널 분야에 맞는 영상 중, 채널 평균보다 크게 잘 된 영상을 매주 골라요.
        </p>

        {list.length === 0 ? (
          feedEmpty && connected.length > 0 ? (
            // 처음 들어왔는데 비어 있으면 기다리게 하지 말고 바로 고른다 (세트를 바꾸면 새로 마운트되게 key)
            <AutoPick key={set.id} setId={set.id} />
          ) : (
            <div className="mt-10 rounded-2xl border border-line bg-card/60 px-4 py-14 text-center">
              <p className="text-sm font-semibold">{connected.length ? "조건에 맞는 영상이 없습니다." : "이 세트에 레퍼런스 채널이 없습니다."}</p>
              <p className="mt-1 text-xs text-sub">
                {connected.length
                  ? "필터의 배수나 게시 시기를 풀어 보세요."
                  : "대시보드에서 이 세트의 폴더에 레퍼런스 채널을 넣으면, 그 분야의 아웃라이어를 골라 드려요."}
              </p>
            </div>
          )
        ) : (
          <div className="mt-4">
            <CardGrid>
              {list.slice(0, PAGE * page).map((v, i) => (
                <VideoCard key={v.videoId} v={v} eager={i < 8} folderButton menu={["similar", "script", "dismiss", "hideChannel"]} />
              ))}
            </CardGrid>
            {list.length > PAGE * page && (
              <div className="mt-6 text-center">
                <a
                  href={`/outliers?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(page + 1) })}`}
                  className="text-[13px] text-sub hover:text-ink"
                >
                  영상 더 보기
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
