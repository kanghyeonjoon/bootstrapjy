import Link from "next/link";

import { hasClaude } from "@/lib/ai";
import { q } from "@/lib/db";
import { AddIdeaButton, ChapterHeader, ClassifyButton, IdeaGroup, NewChapter } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "아이디어" };

export interface IdeaRow {
  id: number;
  claim: string;
  evidence: string | null;
  memo: string | null;
  created_at: string;
  video_id: string | null;
  video_title: string | null;
}

export default async function Ideas({ searchParams }: { searchParams: Promise<{ chapter?: string }> }) {
  const sp = await searchParams;
  const chapters = await q<{ id: number; name: string; n: number }>(
    `SELECT c.id, c.name, (SELECT COUNT(*)::int FROM ideas i WHERE i.chapter_id = c.id) AS n
       FROM chapters c ORDER BY c.position, c.id`,
  );
  const unc = await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM ideas WHERE chapter_id IS NULL");
  const chapterId = chapters.find((c) => String(c.id) === sp.chapter)?.id ?? null;
  const title = chapterId ? chapters.find((c) => c.id === chapterId)!.name : "미분류";

  const rows = await q<IdeaRow>(
    `SELECT i.id, i.claim, i.evidence, i.memo, i.created_at::text, i.video_id,
            COALESCE(v.title_ko, v.title) AS video_title
       FROM ideas i LEFT JOIN videos v ON v.video_id = i.video_id
      WHERE ${chapterId ? "i.chapter_id = $1" : "i.chapter_id IS NULL AND $1::int IS NULL"}
      ORDER BY i.created_at DESC`,
    [chapterId],
  );

  // 원본 영상별로 묶는다. 직접 적은 아이디어는 한 묶음
  const groups = new Map<string, { title: string; videoId: string | null; items: IdeaRow[] }>();
  for (const r of rows) {
    const key = r.video_id ?? "manual";
    if (!groups.has(key)) groups.set(key, { title: r.video_title ?? "직접 적은 아이디어", videoId: r.video_id, items: [] });
    groups.get(key)!.items.push(r);
  }

  const tabs = [{ id: null as number | null, name: "미분류", n: unc[0]?.n ?? 0 }, ...chapters];
  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-5 text-[24px] font-bold tracking-tight">아이디어</h1>
      <div className="flex flex-wrap items-end gap-1">
        {tabs.map((t) => (
          <Link
            key={t.id ?? "u"}
            href={t.id ? `/ideas?chapter=${t.id}` : "/ideas"}
            className={`rounded-t-xl border border-b-0 px-3.5 py-2 text-[13px] ${
              t.id === chapterId ? "border-line bg-card/60 font-semibold" : "border-transparent text-sub hover:text-ink"
            }`}
          >
            {t.name} <span className="text-[11px] text-faint">{t.n || ""}</span>
          </Link>
        ))}
        <NewChapter />
      </div>
      <section className="max-w-[760px] rounded-b-2xl rounded-tr-2xl border border-line bg-card/60 p-4 md:p-5">
        <ChapterHeader id={chapterId} name={title}>
          {!chapterId && (
            <ClassifyButton disabled={!chapters.length || !(unc[0]?.n ?? 0) || !hasClaude()} />
          )}
          <AddIdeaButton chapterId={chapterId} />
        </ChapterHeader>

        {groups.size === 0 ? (
          <div className="mt-4 rounded-xl border border-line px-4 py-12 text-center">
            <p className="text-sm font-semibold">저장한 아이디어가 없습니다.</p>
            <p className="mt-1 text-xs text-sub">영상 분석 결과에서 쓸만한 주장을 저장하거나, 떠오른 아이디어를 직접 적어둘 수 있습니다.</p>
            <Link href="/dashboard" className="mt-4 inline-block rounded-xl bg-ink px-4 py-2 text-[12.5px] font-semibold text-paper">
              대시보드에서 영상 분석하기
            </Link>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {[...groups.values()].map((g) => (
              <IdeaGroup key={g.videoId ?? "manual"} title={g.title} videoId={g.videoId} items={g.items} chapters={chapters} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
