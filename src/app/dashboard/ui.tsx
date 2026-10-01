"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { IconChevron, IconMore, IconSearch, IconSparkle, IconX } from "@/components/icons";
import { toast } from "@/components/Toast";
import { compact } from "@/lib/format";
import type { YtChannel } from "@/lib/youtube";
import {
  addChannels,
  analyzePatterns,
  createFolder,
  deleteFolder,
  findChannels,
  removeChannels,
  setMyChannel,
} from "./actions";
import type { DashParams, FolderChannel } from "./page";

const DEFAULTS = { period: 3, multiplier: 1.5 };

/** URL 쿼리 하나를 바꿔 같은 화면을 다시 그린다 (스크롤 유지) */
function useParam() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    router.replace(`${path}?${p}`, { scroll: false });
  };
}

// ── 폴더 탭 ───────────────────────────────────────────────────

export function FolderTabs({
  folders,
  active,
  mine,
}: {
  folders: Array<{ id: number; name: string; n: number }>;
  active: number;
  mine?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [, start] = useTransition();

  const submit = () =>
    start(async () => {
      const id = await createFolder(name);
      setAdding(false);
      setName("");
      router.push(`/dashboard?folder=${id}`);
    });

  return (
    <div className="flex flex-wrap items-end gap-1">
      <Link
        href="/my-channel"
        className={`rounded-t-xl border border-b-0 px-3.5 py-2 text-[13px] ${
          mine ? "border-line bg-card/60 font-semibold" : "border-line bg-hover/5 text-sub hover:text-ink"
        }`}
      >
        내 채널
      </Link>
      {folders.map((f) => (
        <Link
          key={f.id}
          href={`/dashboard?folder=${f.id}`}
          className={`rounded-t-xl border border-b-0 px-3.5 py-2 text-[13px] ${
            f.id === active ? "border-line bg-card/60 font-semibold" : "border-transparent text-sub hover:text-ink"
          }`}
        >
          {f.name} <span className="text-[11px] text-faint">{f.n}</span>
        </Link>
      ))}
      {adding ? (
        <form
          onSubmit={(e) => (e.preventDefault(), submit())}
          className="mb-1 flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name && setAdding(false)}
            placeholder="폴더 이름"
            className="w-28 bg-transparent text-[13px] outline-none"
          />
          <button className="text-[12px] font-semibold">만들기</button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="px-3 py-2 text-[13px] text-faint hover:text-ink">
          + 새 폴더
        </button>
      )}
    </div>
  );
}

export function EmptyFolders() {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <div className="rounded-2xl border border-line bg-card/60 px-6 py-16 text-center">
      <p className="text-[15px] font-semibold">레퍼런스 폴더를 만들어 시작하세요</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-sub">
        참고하고 싶은 채널을 폴더에 넣으면, 채널 평균보다 잘 된 영상(아웃라이어)이 매일 모입니다.
      </p>
      <button
        onClick={() => start(async () => router.push(`/dashboard?folder=${await createFolder("내 레퍼런스")}`))}
        className="mt-5 rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper"
      >
        + 첫 폴더 만들기
      </button>
    </div>
  );
}

export function DeleteFolderButton({ folderId, name }: { folderId: number; name: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm(`'${name}' 폴더를 삭제할까요? 채널 등록만 풀리고 모아 둔 영상은 남습니다.`)) return;
        start(async () => (await deleteFolder(folderId), router.push("/dashboard")));
      }}
      className="px-2 py-1.5 text-faint hover:text-red-600"
    >
      폴더 삭제
    </button>
  );
}

// ── 채널 추가 모달 ────────────────────────────────────────────

export function AddChannelButton({ folderId, folderName }: { folderId: number; folderName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-paper">
        + 채널 추가
      </button>
      {open && <AddChannelModal folderId={folderId} folderName={folderName} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddChannelModal({ folderId, folderName, onClose }: { folderId: number; folderName: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YtChannel[] | null>(null);
  const [picked, setPicked] = useState<Map<string, YtChannel>>(new Map());
  const [handles, setHandles] = useState<string[]>(["", "", "", "", ""]);
  const [busy, start] = useTransition();

  const filled = handles.filter((h) => h.trim());
  const total = picked.size + filled.length;

  const search = () => start(async () => setResults(await findChannels(query)));
  const submit = () =>
    start(async () => {
      const r = await addChannels(folderId, { ids: [...picked.keys()], handles: filled });
      toast(`${r.added}개 채널을 등록했습니다${r.notFound.length ? ` · 못 찾음: ${r.notFound.join(", ")}` : ""}`);
      onClose();
    });

  return (
    <Modal title={`${folderName}에 채널 추가`} onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), search())} className="flex items-center gap-2 rounded-xl border border-ink px-3 py-2.5">
        <IconSearch className="h-4 w-4 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="채널 이름으로 검색 (예: 슈카월드)"
          className="flex-1 bg-transparent text-[14px] outline-none"
        />
        {busy && <span className="text-[11px] text-faint">찾는 중…</span>}
      </form>

      {results && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line">
          {results.length === 0 && <li className="px-3 py-3 text-[13px] text-faint">검색 결과가 없습니다</li>}
          {results.map((c) => {
            const on = picked.has(c.channelId);
            return (
              <li key={c.channelId}>
                <button
                  type="button"
                  onClick={() =>
                    setPicked((m) => {
                      const n = new Map(m);
                      if (on) n.delete(c.channelId);
                      else n.set(c.channelId, c);
                      return n;
                    })
                  }
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover/5 ${on ? "bg-hover/5" : ""}`}
                >
                  <Avatar src={c.avatarUrl} name={c.title} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.title}</span>
                    <span className="text-[11px] text-faint">
                      구독자 {compact(c.subs)} {c.handle && `· ${c.handle}`}
                    </span>
                  </span>
                  <span className={`text-[12px] font-semibold ${on ? "text-ink" : "text-faint"}`}>{on ? "선택됨" : "선택"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-[12px] font-medium text-sub">@핸들 직접 입력</p>
      <div className="mt-1.5 space-y-1.5 rounded-xl bg-hover/[0.03] p-2">
        {handles.map((h, i) => (
          <input
            key={i}
            value={h}
            onChange={(e) => setHandles((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={i === 0 ? "@brand-makers 또는 채널 주소" : ""}
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-ink"
          />
        ))}
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={() => setHandles((l) => [...l, ""])} className="rounded-lg bg-hover/5 px-2.5 py-1 text-[12px]">
            + 입력칸 추가
          </button>
          <span className="text-[11px] text-faint">{filled.length}개 입력됨</span>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] text-sub">
          취소
        </button>
        <button
          disabled={total === 0 || busy}
          onClick={submit}
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-40"
        >
          {busy && total ? "등록하는 중…" : `${total}개 등록하기 →`}
        </button>
      </div>
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-paper p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button onClick={onClose} aria-label="닫기">
            <IconX className="h-5 w-5 text-faint" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-line text-[12px] font-bold"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

// ── 도구 막대 ─────────────────────────────────────────────────

export function Toolbar({
  mode,
  format,
  sp,
  folderId,
  channels,
}: {
  mode: string;
  format: string;
  sp: DashParams;
  folderId: number;
  channels: FolderChannel[];
}) {
  const set = useParam();
  const latest = sp.sort === "latest";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Segment
          value={mode === "pattern" ? "" : mode}
          options={[
            ["video", "영상"],
            ["channel", "채널"],
          ]}
          onChange={(v) => set({ mode: v, pattern: null })}
        />
        <button
          onClick={() => set({ mode: "pattern" })}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] ${
            mode === "pattern" ? "border-ink bg-ink font-semibold text-paper" : "border-line hover:bg-hover/5"
          }`}
        >
          <IconSparkle className="h-3.5 w-3.5" /> 패턴 분석
        </button>
      </div>

      {mode !== "channel" && (
        <div className="flex flex-wrap items-center gap-2">
          <Segment
            value={format}
            options={[
              ["long", "롱폼"],
              ["short", "쇼츠"],
            ]}
            onChange={(v) => set({ format: v })}
          />
          {mode === "video" && (
            <>
              <Segment
                value={latest ? "latest" : "outlier"}
                options={[
                  ["outlier", "아웃라이어"],
                  ["latest", "최신순"],
                ]}
                onChange={(v) => set({ sort: v === "latest" ? "latest" : null })}
              />
              <select
                value={sp.channel ?? ""}
                onChange={(e) => set({ channel: e.target.value || null })}
                className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] outline-none"
              >
                <option value="">전체 채널</option>
                {channels.map((c) => (
                  <option key={c.channel_id} value={c.channel_id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <FilterButton sp={sp} />
            </>
          )}
        </div>
      )}
      {mode === "channel" && <span data-folder={folderId} />}
    </div>
  );
}

export function Segment({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div role="tablist" className="flex rounded-lg bg-hover/[0.06] p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-[12.5px] ${value === v ? "bg-card font-semibold shadow-sm" : "text-sub"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function FilterButton({ sp }: { sp: DashParams }) {
  const set = useParam();
  const [open, setOpen] = useState(false);
  const [mult, setMult] = useState(Number(sp.multiplier ?? DEFAULTS.multiplier));
  const [period, setPeriod] = useState(Number(sp.period ?? DEFAULTS.period));
  const [hide, setHide] = useState(sp.hideAnalyzed === "1");
  const ref = useRef<HTMLDivElement>(null);

  // 걸려 있는 필터 수 (배수 0 은 "필터 안 함", 기간은 항상 걸려 있다)
  const count = (Number(sp.multiplier ?? DEFAULTS.multiplier) > 0 ? 1 : 0) + 1 + (sp.hideAnalyzed === "1" ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px]"
      >
        필터
        <span className="rounded-full bg-ink px-1.5 text-[10px] font-bold text-paper">
          {count}
        </span>
        <IconChevron className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-2xl border border-line bg-card p-4 shadow-xl">
          <Slider
            label="아웃라이어 배수"
            value={mult}
            min={0}
            max={10}
            step={0.5}
            text={mult === 0 ? "필터 안 함" : `${mult.toFixed(1)}x 이상`}
            hint="0.0x는 배수 필터를 적용하지 않습니다"
            onChange={setMult}
          />
          <Slider
            label="기간"
            value={period}
            min={1}
            max={12}
            step={1}
            text={`최근 ${period}개월`}
            onChange={setPeriod}
          />
          <label className="mt-3 flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="accent-current" />
            분석한 영상 숨기기
          </label>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <button
              onClick={() => (setMult(DEFAULTS.multiplier), setPeriod(DEFAULTS.period), setHide(false))}
              className="text-[12.5px] text-sub"
            >
              기본값
            </button>
            <button
              onClick={() => {
                set({
                  multiplier: mult === DEFAULTS.multiplier ? null : String(mult),
                  period: period === DEFAULTS.period ? null : String(period),
                  hideAnalyzed: hide ? "1" : null,
                });
                setOpen(false);
              }}
              className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-paper"
            >
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex justify-between text-[12px]">
        <span className="text-sub">{props.label}</span>
        <b>{props.text}</b>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[rgb(var(--ink))]"
      />
      {props.hint && <p className="text-[10.5px] text-faint">{props.hint}</p>}
    </div>
  );
}

// ── 채널 보기 ─────────────────────────────────────────────────

export function ChannelGrid({ folderId, channels }: { folderId: number; channels: FolderChannel[] }) {
  const [manage, setManage] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [, start] = useTransition();

  const remove = (ids: string[]) =>
    start(async () => {
      await removeChannels(folderId, ids);
      setSel(new Set());
      toast(`${ids.length}개 채널을 뺐습니다`);
    });

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-end gap-2 text-[12.5px]">
        {manage ? (
          <>
            <span className="text-sub">{sel.size}개 선택됨</span>
            <button disabled={!sel.size} onClick={() => remove([...sel])} className="rounded-lg px-2.5 py-1.5 text-red-600 disabled:opacity-40">
              삭제
            </button>
            <button onClick={() => (setManage(false), setSel(new Set()))} className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-paper">
              완료
            </button>
          </>
        ) : (
          <button onClick={() => setManage(true)} className="rounded-lg bg-hover/5 px-3 py-1.5">
            채널 정리
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {channels.map((c) => {
          const on = sel.has(c.channel_id);
          return (
            <div
              key={c.channel_id}
              onClick={() =>
                manage &&
                setSel((s) => {
                  const n = new Set(s);
                  if (on) n.delete(c.channel_id);
                  else n.add(c.channel_id);
                  return n;
                })
              }
              className={`relative flex items-center gap-3 rounded-2xl border bg-card p-3.5 ${
                manage ? "cursor-pointer" : ""
              } ${on ? "border-ink" : "border-line"}`}
            >
              <Avatar src={c.avatar_url} name={c.title} size={40} />
              <a
                href={`https://www.youtube.com/channel/${c.channel_id}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => manage && e.preventDefault()}
                className="min-w-0 flex-1"
              >
                <p className="truncate text-[13.5px] font-semibold">{c.title}</p>
                <p className="truncate text-[11.5px] text-faint">
                  구독자 {compact(c.subs === null ? null : Number(c.subs))} {c.handle && `· ${c.handle}`}
                </p>
              </a>
              {manage ? (
                <input type="checkbox" readOnly checked={on} className="accent-current" />
              ) : (
                <ChannelMenu onDelete={() => remove([c.channel_id])} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="채널 액션 메뉴" className="rounded p-1 text-faint hover:bg-hover/5">
        <IconMore className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-28 rounded-xl border border-line bg-card py-1 shadow-lg">
          <button role="menuitem" onClick={() => (setOpen(false), onDelete())} className="block w-full px-3 py-2 text-left text-[13px] text-red-600 hover:bg-hover/5">
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

export function PatternButton({
  folderId,
  format,
  label,
  small,
}: {
  folderId: number;
  format: "long" | "short";
  label: string;
  small?: boolean;
}) {
  const [busy, start] = useTransition();
  const run = () =>
    start(async () => {
      try {
        const n = await analyzePatterns(folderId, format);
        toast(`패턴 ${n}개를 찾았습니다`);
      } catch (e) {
        toast((e as Error).message);
      }
    });
  return (
    <button
      disabled={busy}
      onClick={run}
      className={
        small
          ? "text-[11.5px] text-sub hover:text-ink disabled:opacity-50"
          : "rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-50"
      }
    >
      {busy ? "분석하는 중…" : label}
    </button>
  );
}

// ── 내 채널 탭 ────────────────────────────────────────────────

export function MyChannelBar({ format, sort, sp }: { format: string; sort: string; sp: DashParams }) {
  const set = useParam();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <Segment
        value={format}
        options={[
          ["long", "롱폼"],
          ["short", "쇼츠"],
        ]}
        onChange={(v) => set({ format: v })}
      />
      <Segment
        value={sort}
        options={[
          ["outlier", "아웃라이어"],
          ["latest", "최신순"],
        ]}
        onChange={(v) => set({ sort: v === "latest" ? "latest" : null })}
      />
      <FilterButton sp={sp} />
    </div>
  );
}

export function ChangeMyChannel() {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-hover/5 px-2.5 py-1 text-[12px]">
        변경
      </button>
      {open && (
        <Modal title="내 채널 변경" onClose={() => setOpen(false)}>
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="@핸들 또는 채널 주소"
            className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-[14px] outline-none focus:border-ink"
          />
          <div className="mt-4 flex justify-end">
            <button
              disabled={busy || !val.trim()}
              onClick={() =>
                start(async () => {
                  if (await setMyChannel(val)) {
                    setOpen(false);
                    router.refresh();
                  } else toast("채널을 찾지 못했습니다");
                })
              }
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-40"
            >
              {busy ? "불러오는 중…" : "저장"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
