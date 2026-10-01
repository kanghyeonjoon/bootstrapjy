"use server";

import { revalidatePath } from "next/cache";

import { geminiOnVideo, hasGemini, claude, hasClaude } from "@/lib/ai";
import { getKv, one, q, setKv } from "@/lib/db";
import { DEFAULT_BLOCKS, type Block } from "@/lib/scripts";

export async function createScript(): Promise<number> {
  const r = await one<{ id: number }>("INSERT INTO scripts (title, blocks) VALUES ('새 framework', $1) RETURNING id", [
    JSON.stringify(DEFAULT_BLOCKS),
  ]);
  revalidatePath("/scripts");
  return r!.id;
}

export async function deleteScript(id: number): Promise<void> {
  await q("DELETE FROM scripts WHERE id = $1", [id]);
  revalidatePath("/scripts");
}

export async function saveScript(id: number, title: string, blocks: Block[]): Promise<void> {
  await q("UPDATE scripts SET title = $2, blocks = $3, updated_at = now() WHERE id = $1", [
    id,
    title.slice(0, 80) || "제목 없음",
    JSON.stringify(blocks),
  ]);
  await setKv("lastScript", id);
}

export async function clearRef(id: number): Promise<void> {
  await q("UPDATE scripts SET ref_video_id = NULL WHERE id = $1", [id]);
  revalidatePath(`/scripts/${id}`);
}

export async function getTone(): Promise<string> {
  return getKv("myTone", "");
}

export async function saveTone(tone: string): Promise<void> {
  await setKv("myTone", tone.slice(0, 2000));
}

/**
 * "내 채널에서 뽑기" — 내 채널 최근 롱폼 한 편을 Gemini 가 보고 말투를 정리한다.
 * Gemini 키가 없으면 최근 제목들로 Claude 가 짐작한다(정확도는 떨어진다).
 */
export async function extractTone(): Promise<string> {
  const ch = await getKv<string | null>("myChannel", process.env.MY_CHANNEL_ID ?? null);
  if (!ch) throw new Error("대시보드의 '내 채널'을 먼저 지정하세요.");
  const vids = await q<{ video_id: string; title: string }>(
    "SELECT video_id, title FROM videos WHERE channel_id = $1 AND format = 'long' ORDER BY published_at DESC LIMIT 10",
    [ch],
  );
  if (!vids.length) throw new Error("내 채널 영상을 아직 불러오지 못했습니다. 대시보드 '내 채널' 탭을 한 번 열어 주세요.");

  const ask = `이 화자의 말투를 대본 작가가 그대로 흉내 낼 수 있게 정리하라. 한국어, 5~8줄.
- 기본 어미(해요체/합니다체/반말)와 섞는 방식
- 자주 쓰는 접속어·추임새·말버릇 (실제 예시를 「」로)
- 문장 길이와 리듬, 질문을 던지는 방식
- 피하는 표현`;
  if (hasGemini()) return geminiOnVideo(vids[0].video_id, ask);
  if (hasClaude()) return claude(ask, `최근 영상 제목:\n${vids.map((v) => v.title).join("\n")}`, 800);
  throw new Error("말투를 뽑으려면 AI 키가 필요합니다.");
}
