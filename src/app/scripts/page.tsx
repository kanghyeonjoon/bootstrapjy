import Link from "next/link";

import { q } from "@/lib/db";
import { ymd } from "@/lib/format";
import { DeleteScript, NewScript } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "대본" };

export default async function Scripts() {
  const list = await q<{ id: number; title: string; updated_at: Date }>(
    "SELECT id, title, updated_at FROM scripts ORDER BY updated_at DESC",
  );
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[24px] font-bold tracking-tight">대본</h1>
        <NewScript />
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card/60 px-4 py-12 text-center text-sm text-sub">
          아직 대본이 없습니다. <b>+ 새 framework</b> 로 기본 틀(썸네일·제목 → 인트로 → 바디)을 만들어 보세요.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card/60">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link href={`/scripts/${s.id}`} className="min-w-0 flex-1 truncate text-[14px] font-medium hover:underline">
                {s.title}
              </Link>
              <span className="text-[11.5px] text-faint">{ymd(s.updated_at)} 수정</span>
              <DeleteScript id={s.id} title={s.title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
