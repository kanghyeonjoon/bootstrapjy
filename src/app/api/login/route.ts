import { NextResponse } from "next/server";

import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = process.env.APP_PASSWORD ?? "";
  const url = new URL("/dashboard", req.url);

  if (!pw || form.get("password") !== pw) {
    return NextResponse.redirect(new URL("/login?e=1", req.url), 303);
  }
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(AUTH_COOKIE, await tokenFor(pw), {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
