import Link from "next/link";
import { notFound } from "next/navigation";

import { IconCheck } from "@/components/icons";
import { Thumb } from "@/components/VideoCard";
import { ANALYZE_STEPS } from "@/lib/analyze-shared";
import { one } from "@/lib/db";
import { Claims, Hook } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "분석 결과" };

interface Row {
  id: number;
  video_id: string;
  status: string;
  error: string | null;
  hook_lines: Array<{ text: string; tag: string | null }> | null;
  hook_tags: string[] | null;
  claims: Array<{ claim: string; evidence: string }> | null;
  title: string;
  title_ko: string | null;
  thumbnail_url: string | null;
}

export default async function Analysis({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await one<Row>(
    `SELECT a.id, a.video_id, a.status, a.error, a.hook_lines, a.hook_tags, a.claims,
            v.title, v.title_ko, v.thumbnail_url
       FROM analyses a JOIN videos v ON v.video_id = a.video_id WHERE a.id = $1`,
    [Number(id)],
  );
  if (!a) notFound();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[24px] font-bold tracking-tight">분석 결과</h1>
        <Link href="/dashboard" className="text-[12.5px] text-sub hover:text-ink">
          뒤로가기
        </Link>
      </div>

      <div className="max-w-[760px] rounded-2xl border border-line bg-card/60 p-4 md:p-6">
        <a href={`https://www.youtube.com/watch?v=${a.video_id}`} target="_blank" rel="noreferrer" className="block w-60">
          <div className="aspect-video overflow-hidden rounded-xl bg-line/50">
            <Thumb id={a.video_id} src={a.thumbnail_url} eager />
          </div>
          <p className="mt-2 line-clamp-2 text-[13px] font-semibold">{a.title_ko ?? a.title}</p>
        </a>
        <ol className="mt-3 space-y-1.5">
          {ANALYZE_STEPS.map((s) => (
            <li key={s} className="flex items-center gap-2 text-[12.5px]">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-paper">
                <IconCheck className="h-2.5 w-2.5" />
              </span>
              {s}
            </li>
          ))}
        </ol>

        {a.status !== "done" ? (
          <p className="mt-6 text-sm text-sub">{a.error ?? "분석이 아직 끝나지 않았습니다."}</p>
        ) : (
          <>
            <Hook lines={a.hook_lines ?? []} tags={a.hook_tags ?? []} />
            <Claims videoId={a.video_id} claims={a.claims ?? []} />
          </>
        )}
      </div>
    </div>
  );
}
