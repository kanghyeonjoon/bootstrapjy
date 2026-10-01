"use server";

import { revalidatePath } from "next/cache";

import { getKv, one, q, setKv } from "@/lib/db";

/** 카드에서 누르는 버튼들. 어디서 눌렀든 모든 목록이 같은 상태를 보도록 전체를 갱신한다. */
const refresh = () => revalidatePath("/", "layout");

async function defaultTopicId(): Promise<number> {
  const t = await one<{ id: number }>("SELECT id FROM saved_topics ORDER BY position, id LIMIT 1");
  if (t) return t.id;
  const n = await one<{ id: number }>("INSERT INTO saved_topics (name) VALUES ('기본') RETURNING id");
  return n!.id;
}

export async function toggleSave(videoId: string): Promise<boolean> {
  const had = await one("SELECT 1 FROM saved_videos WHERE video_id = $1", [videoId]);
  if (had) await q("DELETE FROM saved_videos WHERE video_id = $1", [videoId]);
  else
    await q("INSERT INTO saved_videos (video_id, topic_id) VALUES ($1, $2)", [videoId, await defaultTopicId()]);
  refresh();
  return !had;
}

export async function setSaveReason(videoId: string, reason: string): Promise<void> {
  await q("UPDATE saved_videos SET reason = $2 WHERE video_id = $1", [videoId, reason.slice(0, 1000) || null]);
  refresh();
}

export async function moveSaved(videoId: string, topicId: number): Promise<void> {
  await q("UPDATE saved_videos SET topic_id = $2 WHERE video_id = $1", [videoId, topicId]);
  refresh();
}

export async function dismissVideo(videoId: string): Promise<void> {
  await q("INSERT INTO dismissed_videos (video_id) VALUES ($1) ON CONFLICT DO NOTHING", [videoId]);
  refresh();
}

export async function hideChannel(channelId: string): Promise<void> {
  await q("INSERT INTO hidden_channels (channel_id) VALUES ($1) ON CONFLICT DO NOTHING", [channelId]);
  refresh();
}

export async function addChannelToFolder(channelId: string, folderId: number): Promise<void> {
  await q(
    "INSERT INTO folder_channels (folder_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [folderId, channelId],
  );
  await q("UPDATE channels SET source = 'folder' WHERE channel_id = $1", [channelId]);
  refresh();
}

export async function listFolders(): Promise<Array<{ id: number; name: string }>> {
  return q("SELECT id, name FROM folders ORDER BY position, id");
}

// ── 대본 연결 ─────────────────────────────────────────────────

/**
 * "이 영상으로 대본 쓰기" — Vidoutliers 처럼 마지막으로 연 대본 맨 위에 레퍼런스 영상을 붙인다.
 * 대본이 하나도 없으면 기본 틀로 새로 만든다. 돌려준 id 로 화면이 이동한다.
 */
export async function scriptFromVideo(videoId: string): Promise<number> {
  const { DEFAULT_BLOCKS } = await import("@/lib/scripts");
  let id = await getKv<number | null>("lastScript", null);
  if (id && !(await one("SELECT 1 FROM scripts WHERE id = $1", [id]))) id = null;
  if (!id) {
    const r = await one<{ id: number }>(
      "INSERT INTO scripts (title, blocks) VALUES ('기본', $1) RETURNING id",
      [JSON.stringify(DEFAULT_BLOCKS)],
    );
    id = r!.id;
  }
  await q("UPDATE scripts SET ref_video_id = $2, updated_at = now() WHERE id = $1", [id, videoId]);
  await setKv("lastScript", id);
  refresh();
  return id;
}
