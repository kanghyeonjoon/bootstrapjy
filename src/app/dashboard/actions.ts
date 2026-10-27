"use server";

import { revalidatePath } from "next/cache";

import { crawlChannel, upsertChannels } from "@/lib/corpus";
import { one, q, setKv } from "@/lib/db";
import { resetSetFit } from "@/lib/fit";
import { runPatterns } from "@/lib/patterns";
import { channelByHandle, channelsByIds, searchChannels, type YtChannel } from "@/lib/youtube";

const refresh = () => revalidatePath("/", "layout");

export async function createFolder(setId: number, name: string): Promise<number> {
  const n = name.trim().slice(0, 40) || "새 폴더";
  const r = await one<{ id: number }>(
    "INSERT INTO folders (name, set_id, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position),0)+1 FROM folders)) RETURNING id",
    [n, setId],
  );
  refresh();
  return r!.id;
}

/** 입력(@핸들·채널 주소·채널 ID)으로 개인 채널을 찾아 DB 에 넣고 처음 긁어 온다 */
async function resolveChannel(input: string): Promise<string | null> {
  const t = input.trim();
  if (!t) return null;
  const idMatch = /(UC[\w-]{22})/.exec(t);
  const c = idMatch ? (await channelsByIds([idMatch[1]]))[0] : await channelByHandle(t);
  if (!c) return null;
  await upsertChannels([c], "folder");
  await crawlChannel(c.channelId);
  return c.channelId;
}

/**
 * 세트를 만든다 — 개인 채널(선택) + 빈 레퍼런스 폴더 하나. 채널을 못 찾으면 null.
 * 세트마다 다음 색을 준다.
 */
export async function createSet(
  name: string,
  channelInput: string,
): Promise<{ setId: number; folderId: number } | null> {
  let channelId: string | null = null;
  if (channelInput.trim()) {
    channelId = await resolveChannel(channelInput);
    if (!channelId) return null;
  }
  const title = channelId ? (await one<{ title: string }>("SELECT title FROM channels WHERE channel_id = $1", [channelId]))?.title : null;
  const s = await one<{ id: number }>(
    `INSERT INTO sets (name, my_channel_id, color, position)
     SELECT $1::text, $2::text, (COALESCE(MAX(color) + 1, 0) % 6)::smallint, COALESCE(MAX(position), 0) + 1 FROM sets RETURNING id`,
    [name.trim().slice(0, 40) || title || "새 세트", channelId],
  );
  const folderId = await createFolder(s!.id, "레퍼런스");
  await syncLegacyMyChannel();
  refresh();
  return { setId: s!.id, folderId };
}

export async function renameSet(id: number, name: string): Promise<void> {
  await q("UPDATE sets SET name = $2 WHERE id = $1", [id, name.trim().slice(0, 40) || "세트"]);
  refresh();
}

/** 세트를 지운다. 폴더·피드·결 점수가 함께 지워지고, 모아 둔 영상(코퍼스)은 남는다 */
export async function deleteSet(id: number): Promise<void> {
  await q("DELETE FROM sets WHERE id = $1", [id]);
  await q(
    `UPDATE channels SET source = 'discovered'
      WHERE source = 'folder' AND channel_id NOT IN (SELECT channel_id FROM folder_channels)
        AND channel_id NOT IN (SELECT my_channel_id FROM sets WHERE my_channel_id IS NOT NULL)`,
  );
  await syncLegacyMyChannel();
  refresh();
}

/** 세트의 개인 채널을 바꾼다. 그 세트의 결 점수는 새 기준으로 다시 매긴다 */
export async function setSetChannel(setId: number, input: string): Promise<boolean> {
  const id = await resolveChannel(input);
  if (!id) return false;
  await q("UPDATE sets SET my_channel_id = $2 WHERE id = $1", [setId, id]);
  await resetSetFit(setId);
  await syncLegacyMyChannel();
  refresh();
  return true;
}

/** 대본 쪽 "내 채널에서 뽑기" 는 kv 'myChannel' 을 읽는다 — 첫 세트의 개인 채널과 맞춰 둔다 */
async function syncLegacyMyChannel(): Promise<void> {
  const first = await one<{ my_channel_id: string | null }>(
    "SELECT my_channel_id FROM sets WHERE my_channel_id IS NOT NULL ORDER BY position, id LIMIT 1",
  );
  if (first?.my_channel_id) await setKv("myChannel", first.my_channel_id);
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

