import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";

import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/Toast";
import { q } from "@/lib/db";
import { corpusSize } from "@/lib/corpus";
import { DAILY_QUOTA, quotaToday } from "@/lib/youtube";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "레퍼런스", template: "%s — 레퍼런스" },
  description: "채널 평균보다 잘 된 영상을 모아 보는 레퍼런스 도구",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 테마는 그리기 전에 정해야 깜빡이지 않는다
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

async function usage() {
  const [quota, corpus, a] = await Promise.all([
    quotaToday(),
    corpusSize(),
    q<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM analyses WHERE created_at >= date_trunc('month', now())",
    ),
  ]);
  return { quota, quotaMax: DAILY_QUOTA, corpus, analysesMonth: Number(a[0]?.n ?? 0) };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = path.startsWith("/login");

  return (
    <html lang="ko" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans">
        {bare ? (
          children
        ) : (
          <div className="md:flex">
            <Sidebar usage={await usage()} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        )}
        <Toaster />
      </body>
    </html>
  );
}
