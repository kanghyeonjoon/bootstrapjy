"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * 화면 아래 잠깐 뜨는 알림. 어디서든 toast("…", {href, action}) 로 부른다.
 * "저장한 영상에 추가됨 · 추가 입력", "아이디어 2개 저장됨 · 보기" 같은 것.
 */
interface ToastMsg {
  id: number;
  text: string;
  href?: string;
  linkText?: string;
}

export function toast(text: string, link?: { href: string; text: string }) {
  window.dispatchEvent(
    new CustomEvent("app-toast", { detail: { id: Date.now(), text, href: link?.href, linkText: link?.text } }),
  );
}

export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<ToastMsg>).detail;
      setList((l) => [...l.slice(-2), m]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== m.id)), 3500);
    };
    window.addEventListener("app-toast", on);
    return () => window.removeEventListener("app-toast", on);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {list.map((m) => (
        <div
          key={m.id}
          className="pointer-events-auto flex items-center gap-3 rounded-xl bg-ink px-4 py-2.5 text-[13px] text-paper shadow-lg"
        >
          {m.text}
          {m.href && (
            <Link href={m.href} className="font-semibold underline underline-offset-2">
              {m.linkText}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
