"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Segment, Slider } from "@/app/dashboard/ui";
import { IconChevron, IconSearch } from "@/components/icons";
import { toast } from "@/components/Toast";
import { refreshOutliers } from "./actions";
import type { OutlierParams } from "./page";

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

export function OutlierToolbar({ sp, setId, switcher }: { sp: OutlierParams; setId: number; switcher: React.ReactNode }) {
  const set = useParam();
  const [text, setText] = useState(sp.q ?? "");
  const [busy, start] = useTransition();

  // 입력이 멈추면 검색
  useEffect(() => {
    if (text === (sp.q ?? "")) return;
    const t = setTimeout(() => set({ q: text || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold tracking-tight">아웃라이어</h1>
        <div className="flex gap-1.5">
          <button
            disabled={busy}
            onClick={() =>
              start(async () => {
                try {
                  const r = await refreshOutliers(setId);
                  toast(`패턴 ${r.patterns}개로 새 영상 ${r.added}개를 골랐습니다`);
                } catch (e) {
                  toast((e as Error).message);
                }
              })
            }
            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] disabled:opacity-50"
          >
            {busy ? "고르는 중…" : "지금 고르기"}
          </button>
        </div>
      </div>

      <div className="mt-4">{switcher}</div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line bg-card px-3 py-2">
          <IconSearch className="h-4 w-4 text-faint" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="제목 검색"
            className="flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        <Segment
          value={sp.sort ?? "recent"}
          options={[
            ["recent", "최근 추가순"],
            ["ratio", "배수순"],
            ["views", "조회수순"],
          ]}
          onChange={(v) => set({ sort: v === "recent" ? null : v })}
        />
        <Filter sp={sp} />
      </div>
    </>
  );
}

function Filter({ sp }: { sp: OutlierParams }) {
  const set = useParam();
  const [open, setOpen] = useState(false);
  const [mult, setMult] = useState(Number(sp.multiplier ?? 0));
  const [months, setMonths] = useState(Number(sp.months ?? 13));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // 슬라이더를 놓으면 바로 적용한다 (Vidoutliers 아웃라이어 필터는 [닫기]만 있다)
  useEffect(() => {
    const t = setTimeout(() => set({ multiplier: mult ? String(mult) : null, months: months <= 12 ? String(months) : null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mult, months]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px]">
        필터 <IconChevron className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-2xl border border-line bg-card p-4 shadow-xl">
          <Slider
            label="배수"
            value={mult}
            min={0}
            max={10}
            step={0.5}
            text={mult === 0 ? "필터 안 함" : `${mult.toFixed(1)}x 이상`}
            hint="0.0x는 배수 필터를 적용하지 않습니다"
            onChange={setMult}
          />
          <Slider
            label="게시 시기"
            value={months}
            min={1}
            max={13}
            step={1}
            text={months > 12 ? "전체" : `최근 ${months}개월`}
            hint="끝까지 올리면 게시 시기를 제한하지 않습니다"
            onChange={setMonths}
          />
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <button onClick={() => (setMult(0), setMonths(13))} className="text-[12.5px] text-sub">
              기본값
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-paper">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 피드가 비어 있을 때 들어오면 바로 고르기를 돌리고, 끝나면 화면을 새로 그린다 */
export function AutoPick({ setId }: { setId: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState("이 세트의 반복 주제(패턴)로 아웃라이어를 고르는 중");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    refreshOutliers(setId)
      .then((r) => {
        if (r.added) router.refresh();
        else setMsg(r.patterns ? "아직 이 패턴과 맞는 영상이 DB 에 없어요. 밤사이 DB 가 넓어지면 채워집니다." : "패턴을 찾지 못했어요. 대시보드 → 패턴 분석을 먼저 해 주세요.");
      })
      .catch((e) => setMsg((e as Error).message));
  }, [router, setId]);
  return (
    <div className="mt-10 rounded-2xl border border-line bg-card/60 px-4 py-14 text-center text-sm">
      {msg}
      {msg.endsWith("중") && <span className="dots ml-1 text-faint" />}
    </div>
  );
}
