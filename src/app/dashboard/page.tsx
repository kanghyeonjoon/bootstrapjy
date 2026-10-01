import Link from "next/link";

import { CardGrid, VideoCard } from "@/components/VideoCard";
import { q } from "@/lib/db";
import { CARD_COLUMNS, cards } from "@/lib/videos";
import {
  AddChannelButton,
  ChannelGrid,
  DeleteFolderButton,
  EmptyFolders,
  FolderTabs,
  PatternButton,
  Toolbar,
} from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "대시보드" };

export interface DashParams {
  folder?: string;
  mode?: "video" | "channel" | "pattern";
  format?: "long" | "short";
  sort?: "outlier" | "latest";
  channel?: string;
  period?: string;
  multiplier?: string;
  hideAnalyzed?: string;
  pattern?: string;
  page?: string;
}

/** Vidoutliers 유료 등급 기본값: 배수 1.5x 이상, 최근 3개월 */
const DEFAULTS = { period: 3, multiplier: 1.5 };
const PAGE = 48;

export default async function Dashboard({ searchParams }: { searchParams: Promise<DashParams> }) {
  const sp = await searchParams;
  const folders = await q<{ id: number; name: string; n: number }>(
    `SELECT f.id, f.name, (SELECT COUNT(*)::int FROM folder_channels fc WHERE fc.folder_id = f.id) AS n
       FROM folders f ORDER BY f.position, f.id`,
  );

  if (folders.length === 0) {
    return (
      <Shell>
        <EmptyFolders />
      </Shell>
    );
  }

  const folder = folders.find((f) => String(f.id) === sp.folder) ?? folders[0];
  const mode = sp.mode ?? "video";
  const format = sp.format ?? "long";

  return (
    <Shell>
      <FolderTabs folders={folders} active={folder.id} />
      <section className="rounded-b-2xl rounded-tr-2xl border border-line bg-card/60 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <p className="text-[13px]">
            <b>{folder.name}</b> <span className="text-faint">· 채널 {folder.n}개</span>
          </p>
          <div className="flex items-center gap-1.5 text-[12.5px]">
            <Link href="/outliers" className="px-2 py-1.5 text-sub hover:text-ink">
              아웃라이어 →
            </Link>
            <AddChannelButton folderId={folder.id} folderName={folder.name} />
            <DeleteFolderButton folderId={folder.id} name={folder.name} />
          </div>
        </div>

        <Toolbar mode={mode} format={format} sp={sp} folderId={folder.id} channels={await folderChannels(folder.id)} />

        {folder.n === 0 ? (
          <p className="py-16 text-center text-sm text-sub">
            아직 채널이 없습니다. 오른쪽 위 <b>+ 채널 추가</b>로 레퍼런스 채널을 등록하세요.
          </p>
        ) : mode === "channel" ? (
          <ChannelGrid folderId={folder.id} channels={await folderChannels(folder.id)} />
        ) : mode === "pattern" ? (
          <Patterns folderId={folder.id} format={format} sp={sp} />
        ) : (
          <Videos folderId={folder.id} format={format} sp={sp} />
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-5 text-[24px] font-bold tracking-tight">대시보드</h1>
      {children}
    </div>
  );
}

export interface FolderChannel {
  channel_id: string;
  title: string;
  handle: string | null;
  avatar_url: string | null;
  subs: string | null;
}

async function folderChannels(folderId: number): Promise<FolderChannel[]> {
  return q(
    `SELECT c.channel_id, c.title, c.handle, c.avatar_url, c.subs::text
       FROM folder_channels fc JOIN channels c ON c.channel_id = fc.channel_id
      WHERE fc.folder_id = $1 ORDER BY fc.added_at DESC`,
    [folderId],
  );
}

async function Videos({ folderId, format, sp }: { folderId: number; format: string; sp: DashParams }) {
  const period = Number(sp.period ?? DEFAULTS.period);
  const mult = Number(sp.multiplier ?? DEFAULTS.multiplier);
  const latest = sp.sort === "latest";
  const page = Math.max(1, Number(sp.page ?? 1));

  const where = [
    "fc.folder_id = $1",
    "v.format = $2",
    `v.published_at >= now() - ($3 || ' months')::interval`,
  ];
  const params: unknown[] = [folderId, format, String(period)];
  // 최신순은 배수와 상관없이 새 영상을 본다. 아웃라이어순만 배수로 거른다.
  if (!latest && mult > 0) {
    params.push(mult);
    where.push(`v.ratio >= $${params.length}`);
  }
  if (sp.channel) {
    params.push(sp.channel);
    where.push(`v.channel_id = $${params.length}`);
  }
  if (sp.hideAnalyzed === "1") where.push("NOT EXISTS (SELECT 1 FROM analyses a WHERE a.video_id = v.video_id)");

  const list = await cards(
    `SELECT ${CARD_COLUMNS} FROM videos v
       JOIN channels c ON c.channel_id = v.channel_id
       JOIN folder_channels fc ON fc.channel_id = v.channel_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${latest ? "v.published_at DESC" : "v.ratio DESC NULLS LAST"}
      LIMIT ${PAGE * page + 1}`,
    params,
  );
  const more = list.length > PAGE * page;

  if (list.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium">아직 표시할 아웃라이어 영상이 없습니다.</p>
        <p className="mt-1 text-xs text-sub">필터의 기간이나 배수를 낮춰보세요.</p>
      </div>
    );
  }

  const next = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  next.set("page", String(page + 1));
  return (
    <div className="mt-4">
      <CardGrid>
        {list.slice(0, PAGE * page).map((v, i) => (
          <VideoCard key={v.videoId} v={v} eager={i < 8} />
        ))}
      </CardGrid>
      {more && (
        <div className="mt-6 text-center">
          <Link href={`/dashboard?${next}`} scroll={false} className="text-[13px] text-sub hover:text-ink">
            영상 더 보기
          </Link>
        </div>
      )}
    </div>
  );
}

async function Patterns({ folderId, format, sp }: { folderId: number; format: string; sp: DashParams }) {
  const patterns = await q<{ id: number; label: string; n: number }>(
    `SELECT p.id, p.label, (SELECT COUNT(*)::int FROM pattern_videos pv WHERE pv.pattern_id = p.id) AS n
       FROM patterns p WHERE p.folder_id = $1 AND p.format = $2 ORDER BY p.position`,
    [folderId, format],
  );

  if (patterns.length === 0) {
    return (
      <div className="py-14 text-center">
        <p className="text-sm font-medium">아직 패턴 분석을 하지 않았습니다.</p>
        <p className="mt-1 text-xs text-sub">
          이 폴더의 최근 1년 {format === "long" ? "롱폼" : "쇼츠"} 아웃라이어 영상에서 반복되는 패턴을 찾습니다.
        </p>
        <div className="mt-4 flex justify-center">
          <PatternButton folderId={folderId} format={format as "long" | "short"} label="분석 요청" />
        </div>
      </div>
    );
  }

  const active = patterns.find((p) => String(p.id) === sp.pattern) ?? patterns[0];
  const list = await cards(
    `SELECT ${CARD_COLUMNS} FROM pattern_videos pv
       JOIN videos v ON v.video_id = pv.video_id JOIN channels c ON c.channel_id = v.channel_id
      WHERE pv.pattern_id = $1 ORDER BY v.ratio DESC NULLS LAST`,
    [active.id],
  );
  const base = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);

  return (
    <div className="mt-4 grid gap-5 md:grid-cols-[240px_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] text-faint">패턴 {patterns.length}</p>
          <PatternButton folderId={folderId} format={format as "long" | "short"} label="다시 분석" small />
        </div>
        <ul className="space-y-0.5">
          {patterns.map((p) => {
            base.set("pattern", String(p.id));
            return (
              <li key={p.id}>
                <Link
                  href={`/dashboard?${base}`}
                  scroll={false}
                  className={`block rounded-lg px-3 py-2 text-[13px] leading-snug ${
                    p.id === active.id ? "bg-ink font-semibold text-paper" : "text-sub hover:bg-hover/5"
                  }`}
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-[12px] text-faint">이 패턴을 쓴 영상들</p>
        <CardGrid cols={3}>
          {list.map((v) => (
            <VideoCard key={v.videoId} v={v} dateStyle="date" menu={[]} />
          ))}
        </CardGrid>
      </div>
    </div>
  );
}
