import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

/**
 * 1) 레이아웃이 현재 경로를 알 수 있게 x-pathname 을 붙인다 (로그인 화면은 사이드바 없이).
 * 2) APP_PASSWORD 가 있으면 로그인 쿠키가 없을 때 /login 으로 보낸다.
 *    크론은 Vercel 이 CRON_SECRET 을 Authorization 헤더로 보내므로 통과시킨다.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const pass = () => {
    const h = new Headers(req.headers);
    h.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: h } });
  };

  const pw = process.env.APP_PASSWORD;
  if (!pw || pathname.startsWith("/login") || pathname.startsWith("/api/login")) return pass();

  const cron = process.env.CRON_SECRET;
  if (pathname.startsWith("/api/cron") && cron && req.headers.get("authorization") === `Bearer ${cron}`) {
    return pass();
  }

  if (req.cookies.get(AUTH_COOKIE)?.value === (await tokenFor(pw))) return pass();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
