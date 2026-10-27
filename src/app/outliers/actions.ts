"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { embedPending, translatePending } from "@/lib/corpus";
import { expandOutliers, pickOutliers, pruneOffNiche } from "@/lib/outliers";

/**
 * 지금 고르기 — 이 세트의 쌓인 DB 에서 패턴별로 바로 고른다 (몇 초).
 * 유튜브를 훑어 DB 를 넓히는 일은 응답 뒤에 이어서 한다. 다음에 고를 때 더 넓은 곳에서 고른다.
 */
export async function refreshOutliers(setId: number): Promise<{ added: number; patterns: number }> {
  const r = await pickOutliers(setId);
  revalidatePath("/outliers");
  after(async () => {
    await pruneOffNiche(setId);
    await expandOutliers(120_000, setId).catch(() => 0);
    await translatePending(150).catch(() => 0);
    await embedPending(180, 130_000).catch(() => 0);
  });
  return r;
}
