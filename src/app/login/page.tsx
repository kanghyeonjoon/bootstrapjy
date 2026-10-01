export const metadata = { title: "로그인" };

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form action="/api/login" method="post" className="w-full max-w-[320px]">
        <p className="text-[22px] font-extrabold tracking-tight">레퍼런스</p>
        <p className="mt-1 text-sm text-sub">비밀번호를 입력하세요.</p>
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          className="mt-5 w-full rounded-xl border border-line bg-card px-4 py-3 text-[15px] outline-none focus:border-ink"
        />
        {e && <p className="mt-2 text-xs text-red-600">비밀번호가 맞지 않습니다.</p>}
        <button className="mt-3 w-full rounded-xl bg-ink py-3 text-[15px] font-semibold text-paper">들어가기</button>
      </form>
    </div>
  );
}
