"use server";

import { revalidatePath } from "next/cache";

import { crawlChannel, upsertChannels } from "@/lib/corpus";
import { one, q } from "@/lib/db";
import { runPatterns } from "@/lib/patterns";
import { channelByHandle, channelsByIds, searchChannels, type YtChannel } from "@/lib/youtube";

const refresh = () => revalidatePath("/", "layout");

export async function createFolder(name: string): Promise<number> {
  const n = name.trim().slice(0, 40) || "새 폴더";
  const r = await one<{ id: number }>(
    "INSERT INTO folders (name, position) VALUES ($1, (SELECT COALESCE(MAX(position),0)+1 FROM folders)) RETURNING id",
    [n],
  );
  refresh();
  return r!.id;
}

export async function renameFolder(id: number, name: string): Promise<void> {
  await q("UPDATE folders SET name = $2 WHERE id = $1", [id, name.trim().slice(0, 40) || "폴더"]);
  refresh();
}

export async function deleteFolder(id: number): Promise<void> {
  await q("DELETE FROM folders WHERE id = $1", [id]);
  // 어느 폴더에도 없는 채널은 발견 채널로 돌린다 (코퍼스에는 남긴다)
  await q(
    `UPDATE channels SET source = 'discovered'
      WHERE source = 'folder' AND channel_id NOT IN (SELECT channel_id FROM folder_channels)`,
  );
  refresh();
}

/** 채널 추가 모달의 이름 검색 (100유닛) */
export async function findChannels(query: string): Promise<YtChannel[]> {
  if (query.trim().length < 2) return [];
  return searchChannels(query.trim());
}

/**
 * 채널들을 폴더에 넣는다. 채널 ID 또는 @핸들/URL 을 받는다.
 * 넣자마자 최근 50편을 긁어 평균과 배수를 낸다 (채널당 2유닛) — 그래야 바로 카드가 보인다.
 */
export async function addChannels(
  folderId: number,
  input: { ids?: string[]; handles?: string[] },
): Promise<{ added: number; notFound: string[] }> {
  const found: YtChannel[] = [];
  const notFound: string[] = [];

  if (input.ids?.length) found.push(...(await channelsByIds(input.ids)));
  for (const raw of input.handles ?? []) {
    const h = raw.trim();
    if (!h) continue;
    const idMatch = /(UC[\w-]{22})/.exec(h);
    const c = idMatch ? (await channelsByIds([idMatch[1]]))[0] : await channelByHandle(h);
    if (c) found.push(c);
    else notFound.push(h);
  }

  await upsertChannels(found, "folder");
  for (const c of found) {
    await q("INSERT INTO folder_channels (folder_id, channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
      folderId,
      c.channelId,
    ]);
  }
  await Promise.all(found.map((c) => crawlChannel(c.channelId)));
  refresh();
  return { added: found.length, notFound };
}

export async function removeChannels(folderId: number, channelIds: string[]): Promise<void> {
  await q("DELETE FROM folder_channels WHERE folder_id = $1 AND channel_id = ANY($2)", [folderId, channelIds]);
  await q(
    `UPDATE channels SET source = 'discovered'
      WHERE channel_id = ANY($1) AND channel_id NOT IN (SELECT channel_id FROM folder_channels)`,
    [channelIds],
  );
  refresh();
}

export async function analyzePatterns(folderId: number, format: "long" | "short"): Promise<number> {
  const n = await runPatterns(folderId, format);
  refresh();
  return n;
}

export async function setMyChannel(input: string): Promise<boolean> {
  const idMatch = /(UC[\w-]{22})/.exec(input);
  const c = idMatch ? (await channelsByIds([idMatch[1]]))[0] : await channelByHandle(input);
  if (!c) return false;
  await upsertChannels([c], "folder");
  await q(
    `INSERT INTO kv (key, value) VALUES ('myChannel', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(c.channelId)],
  );
  await crawlChannel(c.channelId);
  refresh();
  return true;
}
