import { hasLLM, llmJson } from "@/lib/ai";
import { q } from "@/lib/db";

/**
 * 채널의 "결" — 내 레퍼런스 폴더와 같은 주제·비슷한 내용을 다루는 채널인가.
 *
 * 영상 DB 는 유튜브 검색으로 넓히다 보니 결이 다른 채널(예: 명상 폴더인데 연예 뉴스 채널)도 섞인다.
 * Vidoutliers 는 사람이 고른 레퍼런스 채널만 모으니 결이 고르다. 우리는 AI 가 채널마다
 * 0~3점을 매겨 그 효과를 낸다:
 *   3 = 내 폴더 채널과 같은 주제·비슷한 내용   2 = 가까운 주제
 *   1 = 가끔 겹침                              0 = 결이 다름 (아웃라이어·찾기에서 뺀다)
 * 채널 40개(채널명 + 잘 된 영상 제목 5개)당 AI 호출 1번이다.
 */

const BATCH = 40;

async function folderProfile(): Promise<string> {
  const folders = await q<{ id: number; name: string }>("SELECT id, name FROM folders ORDER BY position, id");
  const parts: string[] = [];
  for (const f of folders) {
    const chans = await q<{ title: string }>(
      `SELECT c.title FROM folder_channels fc JOIN channels c ON c.channel_id = fc.channel_id WHERE fc.folder_id = $1 LIMIT 15`,
      [f.id],
    );
    const pats = await q<{ label: string }>("SELECT label FROM patterns WHERE folder_id = $1 ORDER BY position LIMIT 8", [f.id]);
    parts.push(
      `[폴더: ${f.name}]\n채널: ${chans.map((c) => c.title).join(", ")}\n반복 주제: ${pats.map((p) => p.label).join(" / ") || "(아직 없음)"}`,
    );
  }
  return parts.join("\n\n");
}

/** 아직 결을 안 본 채널에 점수를 매긴다. 아웃라이어가 많은 채널부터 */
export async function classifyChannelFit(maxChannels = 400): Promise<number> {
  if (!hasLLM()) return 0;
  // 폴더 채널은 그 자체가 기준이다
  await q(
    `UPDATE channels SET fit = 3 WHERE channel_id IN (SELECT channel_id FROM folder_channels) AND COALESCE(fit, -1) <> 3`,
  );
  const profile = await folderProfile();
  if (!profile) return 0;

  const chans = await q<{ channel_id: string; title: string; titles: string[] }>(
    `SELECT c.channel_id, c.title,
            (SELECT array_agg(t) FROM (SELECT COALESCE(v.title_ko, v.title) AS t FROM videos v
               WHERE v.channel_id = c.channel_id ORDER BY v.ratio DESC NULLS LAST LIMIT 5) x) AS titles
       FROM channels c
      WHERE c.fit IS NULL
      ORDER BY (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.channel_id AND v.ratio >= 2) DESC
      LIMIT $1`,
    [maxChannels],
  );
  let n = 0;
  for (let i = 0; i < chans.length; i += BATCH) {
    const batch = chans.slice(i, i + BATCH);
    const list = batch.map((c) => `${c.channel_id} | ${c.title} | ${(c.titles ?? []).join(" / ")}`).join("\n");
    let out: Record<string, number>;
    try {
      out = await llmJson<Record<string, number>>(
        `너는 유튜브 레퍼런스 큐레이터다. 사용자의 레퍼런스 폴더(채널·반복 주제)와 후보 채널 목록을 받는다.
각 후보 채널이 폴더와 "같은 주제·비슷한 내용"을 다루는지 0~3점을 매긴다.
3 = 폴더 채널과 같은 주제·비슷한 내용 / 2 = 가까운 주제 / 1 = 가끔 겹침 / 0 = 결이 다름.
폴더가 여러 개면 가장 가까운 폴더 기준. 출력은 {"채널ID": 점수} JSON 하나만.`,
        `${profile}\n\n후보 채널 (id | 이름 | 잘 된 영상 제목들):\n${list}`,
        { maxTokens: 2000, lite: true },
      );
    } catch {
      break; // 무료 한도 — 다음에 이어서
    }
    const rows = batch
      .filter((c) => typeof out[c.channel_id] === "number")
      .map((c) => ({ id: c.channel_id, f: Math.max(0, Math.min(3, Math.round(out[c.channel_id]))) }));
    if (rows.length) {
      await q(
        `UPDATE channels c SET fit = r.f FROM jsonb_to_recordset($1::jsonb) AS r(id text, f int) WHERE c.channel_id = r.id`,
        [JSON.stringify(rows)],
      );
      n += rows.length;
    }
  }
  return n;
}

/** 폴더가 바뀌면 결 점수를 다시 매겨야 한다 */
export async function resetChannelFit(): Promise<void> {
  await q("UPDATE channels SET fit = NULL WHERE channel_id NOT IN (SELECT channel_id FROM folder_channels)");
}
