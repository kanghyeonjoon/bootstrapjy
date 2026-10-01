"use server";

import { revalidatePath } from "next/cache";

import { one, q } from "@/lib/db";

const refresh = () => revalidatePath("/saved");

export async function createTopic(name: string): Promise<number> {
  const r = await one<{ id: number }>(
    "INSERT INTO saved_topics (name, position) VALUES ($1, (SELECT COALESCE(MAX(position),0)+1 FROM saved_topics)) RETURNING id",
    [name.trim().slice(0, 40) || "새 주제"],
  );
  refresh();
  return r!.id;
}

export async function renameTopic(id: number, name: string): Promise<void> {
  await q("UPDATE saved_topics SET name = $2 WHERE id = $1", [id, name.trim().slice(0, 40)]);
  refresh();
}

export async function deleteTopic(id: number): Promise<void> {
  await q("DELETE FROM saved_topics WHERE id = $1", [id]);
  refresh();
}
