// 비밀번호 게이트 — 마인드맵 도구(E:\클로드코드\src\lib\auth.ts)와 같은 방식.
// edge(미들웨어)와 node 양쪽에서 돌도록 Web Crypto 만 쓴다.

export const AUTH_COOKIE = "ref_auth";

/** 쿠키에는 원문 비밀번호가 아니라 해시를 담는다 */
export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode("reference-site:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
