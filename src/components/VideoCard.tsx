"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  addChannelToFolder,
  dismissVideo,
  hideChannel,
  listFolders,
  scriptFromVideo,
  toggleSave,
} from "@/app/actions";
import { IconBookmark, IconMore } from "@/components/icons";
import { toast } from "@/components/Toast";
import { compact, duration, ratioColor, ratioText, since, ymd } from "@/lib/format";
import type { VideoCardData } from "@/lib/videos";

export type CardMenu = "similar" | "script" | "dismiss" | "hideChannel";

/**
 * 영상 카드 — 대시보드·아웃라이어·영상 찾기·패턴·저장 화면이 모두 이것을 쓴다.
 * 화면마다 다른 건 ⋯ 메뉴 항목과 "폴더에 추가" 버튼 여부뿐이다.
 */
export function VideoCard({
  v,
  menu = ["similar", "script"],
  folderButton = false,
  dateStyle = "since",
  eager,
  footer,
  extraMenu = [],
  hideSave,
}: {
  v: VideoCardData;
  menu?: CardMenu[];
  folderButton?: boolean;
  dateStyle?: "since" | "date";
  eager?: boolean;
  footer?: React.ReactNode;
  /** 화면 전용 메뉴 항목 (저장한 영상의 "주제 이동" 등) */
  extraMenu?: Array<{ label: string; run: () => void }>;
  hideSave?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(v.saved);
  const [gone, setGone] = useState(false);
  const [, start] = useTransition();
  useEffect(() => setSaved(v.saved), [v.saved]);
  if (gone) return null;

  const url = `https://www.youtube.com/watch?v=${v.videoId}`;
  const title = v.titleKo ?? v.title;

  const onSave = () =>
    start(async () => {
      const now = await toggleSave(v.videoId);
      setSaved(now);
      toast(now ? "저장한 영상에 추가됨" : "저장 취소됨", now ? { href: "/saved", text: "추가 입력" } : undefined);
    });

  const items: Array<{ key: CardMenu; label: string; run: () => void }> = [
    { key: "similar", label: "비슷한 영상 찾기", run: () => router.push(`/find?similar=${v.videoId}`) },
    {
      key: "script",
      label: "이 영상으로 대본 쓰기",
      run: () => start(async () => router.push(`/scripts/${await scriptFromVideo(v.videoId)}`)),
    },
    {
      key: "dismiss",
      label: "관심 없음",
      run: () => start(async () => (await dismissVideo(v.videoId), setGone(true))),
    },
    {
      key: "hideChannel",
      label: "이 채널 안 보기",
      run: () =>
        start(async () => {
          await hideChannel(v.channelId);
          setGone(true);
          toast(`${v.channelTitle} 채널을 숨겼습니다`);
        }),
    },
  ];

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <a href={url} target="_blank" rel="noreferrer" className="relative block aspect-video bg-line/50">
        <Thumb id={v.videoId} src={v.thumbnailUrl} eager={eager} />
        {v.ratio !== null && v.ratio > 0 && (
          <span
            className="absolute right-2 top-2 rounded-md px-1.5 py-[3px] text-[12px] font-bold leading-none text-white tabular"
            style={{ backgroundColor: ratioColor(v.ratio) }}
            title="조회수 ÷ 이 채널 평균 조회수"
          >
            {ratioText(v.ratio)}
          </span>
        )}
        {v.durationSec > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 text-[10px] font-medium text-white tabular">
            {duration(v.durationSec)}
          </span>
        )}
      </a>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        <a href={url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[13.5px] font-semibold leading-snug hover:underline">
          {title}
        </a>
        {v.titleKo && <p className="mt-0.5 line-clamp-1 text-[11px] text-faint">{v.title}</p>}

        <div className="mt-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0 text-[12px] text-sub">
            <p className="truncate">{v.channelTitle}</p>
            <p className="tabular">
              조회수 {compact(v.viewCount)} · {dateStyle === "date" ? ymd(v.publishedAt) : since(v.publishedAt)}
            </p>
          </div>
          {menu.length + extraMenu.length > 0 && (
            <Menu items={[...items.filter((i) => menu.includes(i.key)), ...extraMenu]} label={`${title} 카드 메뉴`} />
          )}
        </div>

        {v.analysisId && (
          <span className="mt-1.5 w-fit rounded bg-[#7FA968]/15 px-1.5 py-0.5 text-[10.5px] font-medium text-[#4E7A3A] dark:text-[#9CC686]">
            자막 확인됨
          </span>
        )}

        <div className="mt-auto pt-3">
          <div className="flex gap-1.5">
            <Link
              href={v.analysisId ? `/videos/${v.analysisId}` : `/videos/new?v=${v.videoId}`}
              className="flex-1 rounded-lg bg-ink py-2 text-center text-[12.5px] font-semibold text-paper"
            >
              분석하기 →
            </Link>
            {!hideSave && <button
              onClick={onSave}
              aria-label={saved ? "저장 취소" : "저장"}
              className={`rounded-lg border border-line px-2.5 ${saved ? "text-ink" : "text-faint hover:text-ink"}`}
            >
              <IconBookmark className="h-4 w-4" filled={saved} />
            </button>}
          </div>
          {folderButton && !v.inFolder && <AddToFolder channelId={v.channelId} />}
          {footer}
        </div>
      </div>
    </article>
  );
}

function Menu({ items, label }: { items: Array<{ label: string; run: () => void }>; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} aria-label={label} className="rounded p-1 text-faint hover:bg-hover/5 hover:text-ink">
        <IconMore className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => (setOpen(false), it.run())}
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-hover/5"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddToFolder({ channelId }: { channelId: string }) {
  const [folders, setFolders] = useState<Array<{ id: number; name: string }> | null>(null);
  const [done, setDone] = useState(false);
  const [, start] = useTransition();
  if (done) return null;

  return (
    <div className="relative mt-1.5">
      <button
        onClick={() => start(async () => setFolders(folders ? null : await listFolders()))}
        className="w-full rounded-lg bg-hover/5 py-2 text-[12.5px] font-medium text-sub hover:bg-hover/10"
      >
        폴더에 추가
      </button>
      {folders && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-xl border border-line bg-card py-1 shadow-lg">
          {folders.length === 0 && <p className="px-3 py-2 text-[12px] text-faint">폴더가 없습니다</p>}
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() =>
                start(async () => {
                  await addChannelToFolder(channelId, f.id);
                  setDone(true);
                  toast(`'${f.name}' 폴더에 채널을 추가했습니다`);
                })
              }
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-hover/5"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** maxres 가 없는 영상이 있다. 그때 hqdefault 로 한 번 갈아탄다 (모든 영상에 존재) */
export function Thumb({ id, src, eager }: { id: string; src: string | null; eager?: boolean }) {
  const fallback = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const [cur, setCur] = useState(src ?? fallback);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cur}
      alt=""
      loading={eager ? "eager" : "lazy"}
      className="h-full w-full object-cover"
      onError={() => cur !== fallback && setCur(fallback)}
    />
  );
}

export function CardGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 3 | 4 }) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${cols === 4 ? "lg:grid-cols-3 xl:grid-cols-4" : "lg:grid-cols-3"}`}
    >
      {children}
    </div>
  );
}
