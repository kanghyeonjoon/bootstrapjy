"use server";

import { revalidatePath } from "next/cache";

import { claudeJson, hasClaude } from "@/lib/ai";
import { one, q } from "@/lib/db";

const refresh = () => revalidatePath("/ideas");

export async function createChapter(name: string): Promise<number> {
  const r = await one<{ id: number }>(
    "INSERT INTO chapters (name, position) VALUES ($1, (SELECT COALESCE(MAX(position),0)+1 FROM chapters)) RETURNING id",
    [name.trim().slice(0, 40) || "새 챕터"],
  );
  refresh();
  return r!.id;
}

export async function renameChapter(id: number, name: string): Promise<void> {
  await q("UPDATE chapters SET name = $2 WHERE id = $1", [id, name.trim().slice(0, 40)]);
  refresh();
}

export async function deleteChapter(id: number): Promise<void> {
  await q("DELETE FROM chapters WHERE id = $1", [id]);
  refresh();
}

export async function addIdea(chapterId: number | null, claim: string, memo: string): Promise<void> {
  if (!claim.trim()) return;
  await q("INSERT INTO ideas (chapter_id, claim, memo) VALUES ($1, $2, $3)", [chapterId, claim.trim(), memo.trim() || null]);
  refresh();
}

export async function deleteIdea(id: number): Promise<void> {
  await q("DELETE FROM ideas WHERE id = $1", [id]);
  refresh();
}

export async function moveIdea(id: number, chapterId: number | null): Promise<void> {
  await q("UPDATE ideas SET chapter_id = $2 WHERE id = $1", [id, chapterId]);
  refresh();
}

/**
 * AI 분류 — 미분류 아이디어를 내가 만든 챕터들에 나눠 넣는다.
 * 챕터가 하나도 없으면 할 수 없다 (그래서 Vidoutliers 도 그때는 버튼이 꺼져 있다).
 */
export async function classifyIdeas(): Promise<number> {
  if (!hasClaude()) throw new Error("AI 분류에는 ANTHROPIC_API_KEY 가 필요합니다.");
  const chapters = await q<{ id: number; name: string }>("SELECT id, name FROM chapters ORDER BY position, id");
  const ideas = await q<{ id: number; claim: string; evidence: string | null }>(
    "SELECT id, claim, evidence FROM ideas WHERE chapter_id IS NULL ORDER BY id LIMIT 200",
  );
  if (!chapters.length || !ideas.length) return 0;

  const out = await claudeJson<Record<string, number | null>>(
    `아이디어 목록을 주어진 챕터(영상 기획의 장)로 나눈다. 각 아이디어 id 에 가장 맞는 챕터 id 를, 어디에도 안 맞으면 null 을 준다.
출력은 {"아이디어id": 챕터id|null} JSON 하나만.`,
    `챕터:\n${chapters.map((c) => `${c.id}: ${c.name}`).join("\n")}\n\n아이디어:\n${ideas
      .map((i) => `${i.id}: ${i.claim}${i.evidence ? ` — ${i.evidence.slice(0, 120)}` : ""}`)
      .join("\n")}`,
    3000,
  );
  const valid = new Set(chapters.map((c) => c.id));
  let n = 0;
  for (const [ideaId, ch] of Object.entries(out)) {
    if (ch !== null && valid.has(ch)) {
      await q("UPDATE ideas SET chapter_id = $2 WHERE id = $1 AND chapter_id IS NULL", [Number(ideaId), ch]);
      n++;
    }
  }
  refresh();
  return n;
}
