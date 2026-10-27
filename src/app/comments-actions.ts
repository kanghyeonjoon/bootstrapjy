"use server";

import { revalidatePath } from "next/cache";

import { buildDigest, getDigest, saveSeedAsIdea, type CommentDigest, type Seed } from "@/lib/comments";

/** 저장된 댓글 씨앗이 있으면 그것을, 없거나 refresh 면 새로 받아 묶는다 */
export async function commentDigest(videoId: string, refresh = false): Promise<CommentDigest> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error("영상 ID 가 올바르지 않습니다.");
  if (!refresh) {
    const saved = await getDigest(videoId);
    if (saved) return saved;
  }
  return buildDigest(videoId);
}

export async function saveSeed(videoId: string, seed: Seed): Promise<void> {
  const d = await getDigest(videoId);
  await saveSeedAsIdea(videoId, seed, d?.comments ?? []);
  revalidatePath("/ideas");
}
