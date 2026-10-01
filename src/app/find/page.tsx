import Link from "next/link";

import { one, q } from "@/lib/db";
import { since } from "@/lib/format";
import { Composer } from "./composer";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상 찾기" };

/** 패턴 분석을 해 둔 폴더가 있으면 그 패턴을 예시로, 없으면 기본 예시를 깐다 */
const FALLBACK = [
  "유튜브 초보가 시작하자마자 포기하는 이유",
  "불안할 때 신경계를 진정시키는 방법",
  "무의식을 바꿔 원하는 삶을 만드는 원리",
  "퇴사하고 1인 사업으로 자리 잡은 사례",
  "아침 루틴 하나로 인생이 바뀐 이야기",
];

export default async function FindPage({ searchParams }: { searchParams: Promise<{ similar?: string }> }) {
  const { similar } = await searchParams;
  const seed = similar
    ? await one<{ title: string; title_ko: string | null }>("SELECT title, title_ko FROM videos WHERE video_id = $1", [similar])
    : null;

  const patterns = await q<{ label: string }>("SELECT label FROM patterns ORDER BY random() LIMIT 5");
  const suggestions = patterns.length >= 3 ? patterns.map((p) => p.label) : FALLBACK;
  const recent = await q<{ id: number; prompt: string; created_at: Date; n: number; seed_video: string | null }>(
    `SELECT f.id, f.prompt, f.created_at, f.seed_video,
            (SELECT COUNT(*)::int FROM find_hits h WHERE h.find_id = f.id) AS n
       FROM finds f WHERE f.status = 'done' ORDER BY f.id DESC LIMIT 8`,
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="text-[24px] font-bold tracking-tight">영상 찾기</h1>
      <div className="mt-8 md:mt-12">
        <Composer
          key={similar ?? "new"}
          suggestions={suggestions}
          similar={seed ? similar : undefined}
          similarTitle={seed ? (seed.title_ko ?? seed.title) : undefined}
        />
      </div>

      {!similar && recent.length > 0 && (
        <div className="mx-auto mt-12 max-w-[640px]">
          <p className="mb-2 text-[11px] font-medium text-faint">최근 찾기</p>
          <ul className="divide-y divide-line rounded-xl border border-line bg-card/60">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/find/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/5">
                  <span className="truncate text-[13px]">
                    {r.seed_video && <span className="text-faint">비슷한 영상 · </span>}
                    {r.prompt}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {r.n}편 · {since(r.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
