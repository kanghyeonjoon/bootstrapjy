import { notFound } from "next/navigation";

import { one, setKv } from "@/lib/db";
import type { Block } from "@/lib/scripts";
import { Editor } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "대본" };

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await one<{
    id: number;
    title: string;
    blocks: Block[];
    ref_video_id: string | null;
    ref_title: string | null;
    ref_thumb: string | null;
  }>(
    `SELECT s.id, s.title, s.blocks, s.ref_video_id,
            COALESCE(v.title_ko, v.title) AS ref_title, v.thumbnail_url AS ref_thumb
       FROM scripts s LEFT JOIN videos v ON v.video_id = s.ref_video_id WHERE s.id = $1`,
    [Number(id)],
  );
  if (!s) notFound();
  await setKv("lastScript", s.id);

  return (
    <Editor
      id={s.id}
      initialTitle={s.title}
      initialBlocks={s.blocks}
      refVideo={s.ref_video_id ? { id: s.ref_video_id, title: s.ref_title ?? "", thumb: s.ref_thumb } : null}
    />
  );
}
