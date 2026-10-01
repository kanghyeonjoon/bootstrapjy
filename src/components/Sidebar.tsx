"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  IconBookmark,
  IconBulb,
  IconDashboard,
  IconGear,
  IconMenu,
  IconScript,
  IconTelescope,
  IconTrend,
  IconX,
} from "@/components/icons";

const GROUPS = [
  {
    label: "리서치",
    items: [
      { href: "/dashboard", label: "대시보드", icon: IconDashboard, match: ["/dashboard", "/my-channel"] },
      { href: "/outliers", label: "아웃라이어", icon: IconTrend },
      { href: "/find", label: "영상 찾기", icon: IconTelescope },
      { href: "/saved", label: "저장한 영상", icon: IconBookmark },
    ],
  },
  {
    label: "기획",
    items: [
      { href: "/ideas", label: "아이디어", icon: IconBulb },
      { href: "/scripts/last", label: "대본", icon: IconScript, beta: true, match: ["/scripts"] },
    ],
  },
  {
    label: "계정",
    items: [{ href: "/settings", label: "설정", icon: IconGear }],
  },
];

export interface Usage {
  quota: number;
  quotaMax: number;
  corpus: number;
  analysesMonth: number;
}

/**
 * 왼쪽 사이드바. 폰 폭에서는 상단 바 + 햄버거 서랍으로 바뀐다.
 * 아래쪽 사용량은 Vidoutliers 의 "영상 분석 N/40" 자리에 우리 쪽 제약(유튜브 할당량)을 둔다.
 */
export function Sidebar({ usage }: { usage: Usage }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const nav = (
    <nav className="flex flex-1 flex-col overflow-y-auto">
      {GROUPS.map((g) => (
        <div key={g.label} className="mt-5 first:mt-4">
          <p className="px-3 pb-1.5 text-[11px] font-medium text-faint">{g.label}</p>
          {g.items.map((it) => {
            const match = "match" in it && it.match ? it.match : [it.href];
            const active = match.some((m) => path === m || path.startsWith(m + "/"));
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition ${
                  active ? "bg-ink font-semibold text-paper" : "text-ink/80 hover:bg-hover/5"
                }`}
              >
                <Icon className="h-[17px] w-[17px]" />
                {it.label}
                {"beta" in it && it.beta && (
                  <span
                    className={`rounded border px-1 text-[9px] font-semibold tracking-wide ${
                      active ? "border-paper/40" : "border-line text-faint"
                    }`}
                  >
                    beta
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const foot = (
    <div className="border-t border-line pt-3 text-[12px]">
      <p className="mb-1.5 text-[11px] text-faint">사용량</p>
      <div className="flex justify-between py-0.5">
        <span className="text-sub">유튜브 할당량</span>
        <span className="tabular">
          <b>{usage.quota.toLocaleString()}</b>
          <span className="text-faint">/{(usage.quotaMax / 1000).toFixed(0)}k 오늘</span>
        </span>
      </div>
      <div className="flex justify-between py-0.5">
        <span className="text-sub">영상 분석</span>
        <span className="tabular">
          <b>{usage.analysesMonth}</b> <span className="text-faint">이번 달</span>
        </span>
      </div>
      <div className="flex justify-between py-0.5">
        <span className="text-sub">영상 DB</span>
        <span className="tabular">
          <b>{usage.corpus.toLocaleString()}</b> <span className="text-faint">편</span>
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* 폰: 상단 바 */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-side px-4 py-3 md:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} aria-label="메뉴 열기" className="p-1">
          <IconMenu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-side px-3 py-4">
            <div className="flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="메뉴 닫기">
                <IconX className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {foot}
          </aside>
        </div>
      )}

      {/* 데스크톱: 고정 사이드바 */}
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-line bg-side px-3 py-5 md:flex">
        <div className="px-2">
          <Logo />
        </div>
        {nav}
        {foot}
      </aside>
    </>
  );
}

function Logo() {
  return (
    <Link href="/dashboard" className="text-[17px] font-extrabold tracking-tight">
      레퍼런스
    </Link>
  );
}
