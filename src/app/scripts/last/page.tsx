import { redirect } from "next/navigation";

import { getKv, one } from "@/lib/db";
import { DEFAULT_BLOCKS } from "@/lib/scripts";

export const dynamic = "force-dynamic";

/** 사이드바 "대본" — 마지막으로 연 대본으로 간다. 없으면 기본 틀로 하나 만든다. */
export default async function LastScript() {
  const last = await getKv<number | null>("lastScript", null);
  const hit =
    (last && (await one<{ id: number }>("SELECT id FROM scripts WHERE id = $1", [last]))) ||
    (await one<{ id: number }>("SELECT id FROM scripts ORDER BY updated_at DESC LIMIT 1")) ||
    (await one<{ id: number }>("INSERT INTO scripts (title, blocks) VALUES ('기본', $1) RETURNING id", [
      JSON.stringify(DEFAULT_BLOCKS),
    ]));
  redirect(`/scripts/${hit!.id}`);
}
