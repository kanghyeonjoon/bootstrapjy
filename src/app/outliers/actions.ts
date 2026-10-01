"use server";

import { revalidatePath } from "next/cache";

import { runOutlierBatch, setFolderLink } from "@/lib/outliers";

export async function saveFolderLink(pinned: number[]): Promise<void> {
  await setFolderLink(pinned);
  revalidatePath("/outliers");
}

/** 주간 배치를 지금 돌린다 */
export async function refreshOutliers(): Promise<{ added: number; patterns: number }> {
  const r = await runOutlierBatch(200_000);
  revalidatePath("/outliers");
  return r;
}
