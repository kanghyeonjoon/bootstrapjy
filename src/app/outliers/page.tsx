import { CardGrid, VideoCard } from "@/components/VideoCard";
import { getKv, q } from "@/lib/db";
import { since } from "@/lib/format";
import { connectedFolders } from "@/lib/outliers";
import { CARD_COLUMNS, cards } from "@/lib/videos";
import { AutoPick, OutlierToolbar } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "아웃라이어" };

export interface OutlierParams {
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
    `SELECT ${CARD_COLUMNS} FROM outlier_feed o
       JOIN videos v ON v.video_id = o.video_id JOIN channels c ON c.channel_id = v.channel_id
      WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${PAGE * page + 1}`,
    params,
  );

  const folders = await q<{ id: number; name: string; n: number }>(
    `SELECT f.id, f.name, (SELECT COUNT(*)::int FROM folder_channels fc WHERE fc.folder_id = f.id) AS n
       FROM folders f ORDER BY f.position, f.id`,
  );
  const connected = await connectedFolders();
  const pinned = (await getKv<{ pinned: number[] }>("outlierFolders", { pinned: [] })).pinned;
  const refreshed = await getKv<string | null>("outliersRefreshedAt", null);
  const feedEmpty = !(await q("SELECT 1 FROM outlier_feed LIMIT 1")).length;

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1100px]">
        <OutlierToolbar sp={sp} folders={folders} connected={connected} pinned={pinned} />
        <p className="mt-2 text-[11.5px] text-faint">
          {refreshed ? `${since(refreshed)} 갱신 · ` : ""}연결한 폴더의 패턴과 비슷한 주제로 채널 평균보다 크게 잘 된 영상을 매주 골라요.
        </p>

        {list.length === 0 ? (
          feedEmpty && connected.length > 0 ? (
            // 처음 들어왔는데 비어 있으면 기다리게 하지 말고 바로 고른다
            <AutoPick />
          ) : (
            <div className="mt-10 rounded-2xl border border-line bg-card/60 px-4 py-14 text-center">
              <p className="text-sm font-semibold">{connected.length ? "조건에 맞는 영상이 없습니다." : "연결할 폴더가 없습니다."}</p>
              <p className="mt-1 text-xs text-sub">
                {connected.length
                  ? "필터의 배수나 게시 시기를 풀어 보세요."
                  : "대시보드에서 폴더를 만들고 레퍼런스 채널을 넣으면, 그 분야의 아웃라이어를 골라 드려요."}
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
