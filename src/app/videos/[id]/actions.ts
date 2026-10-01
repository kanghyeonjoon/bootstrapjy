"use server";

import { revalidatePath } from "next/cache";

import { q } from "@/lib/db";

/** 분석 결과의 핵심 주장을 아이디어로 보낸다 (미분류 챕터) */
export async function saveIdeas(videoId: string, items: Array<{ claim: string; evidence: string }>): Promise<number> {
  for (const it of items) {
    await q("INSERT INTO ideas (video_id, claim, evidence) VALUES ($1, $2, $3)", [videoId, it.claim, it.evidence]);
  }
  revalidatePath("/ideas");
  return items.length;
}
