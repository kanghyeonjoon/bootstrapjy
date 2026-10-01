import { embed, hasGemini, hasLLM, llmJson } from "@/lib/ai";
import { embedPending, ingestVideos, isKorean, translatePending } from "@/lib/corpus";
import { getKv, q, setKv, vec } from "@/lib/db";
import { runPatterns } from "@/lib/patterns";
import { searchVideos } from "@/lib/youtube";

/**
 * 아웃라이어 탭 — 연결한 폴더의 "반복 주제(패턴)"를 기준으로, 영상 DB 전체에서
 * 그 주제로 크게 잘 된 영상을 골라 피드에 쌓는다. 매주 한 번 돈다.
 *
 * Vidoutliers 의 "폴더 연결" 모달 문구가 이 구조를 말해 준다:
 *   "폴더의 반복 주제(패턴)를 기준으로 골라요. 폴더 연결 변경은 다음 주부터 적용돼요."
 * 그래서 내 레퍼런스(명상·뇌과학)와 비슷한 영상만 나온다.
 */

const PER_PATTERN = 12;
const MIN_RATIO = 2;
/** 패턴 하나당 유튜브 검색으로 새로 들일 채널 상한 (채널당 4유닛) */
const NEW_CHANNELS_PER_PATTERN = 12;
/** 자동 연결 때 쓸 폴더 수 */
const AUTO_FOLDERS = 3;

export interface FolderLink {
  /** 직접 고른 폴더. 비어 있으면 채널이 많은 폴더부터 자동으로 채운다 */
  pinned: number[];
}

export async function connectedFolders(): Promise<number[]> {
  const link = await getKv<FolderLink>("outlierFolders", { pinned: [] });
  const all = await q<{ id: number }>(
    `SELECT f.id FROM folders f
      ORDER BY (SELECT COUNT(*) FROM folder_channels fc WHERE fc.folder_id = f.id) DESC, f.id`,
  );
  const ids = all.map((r) => r.id);
  const pinned = link.pinned.filter((id) => ids.includes(id));
  return [...pinned, ...ids.filter((id) => !pinned.includes(id))].slice(0, Math.max(AUTO_FOLDERS, pinned.length));
}

export async function setFolderLink(pinned: number[]): Promise<void> {
  await setKv("outlierFolders", { pinned });
}

/** 패턴 하나로 새 아웃라이어를 고른다 */
async function pickForPattern(folderId: number, label: string, budgetNewChannels: number): Promise<number> {
  // 1) 유튜브에서 이 주제를 훑어 DB 를 넓힌다
  const queries = hasLLM()
    ? (
        await llmJson<{ q: string[] }>(
          '유튜브 영상 주제 하나를 받아, 같은 주제의 인기 영상을 찾을 유튜브 검색어 2개를 만든다. 한국어 하나, 영어 하나. {"q":["...","..."]} JSON 하나만.',
          label,
          { maxTokens: 300, lite: true },
        )
      ).q
    : [label];
  const found = (
    await Promise.all(queries.map((s) => searchVideos(s, isKorean(s) ? { lang: "ko", region: "KR" } : { lang: "en" }).catch(() => [])))
  ).flat();
  await ingestVideos(found, { maxNewChannels: budgetNewChannels });
  await translatePending(80).catch(() => 0);
  await embedPending(600).catch(() => 0);

  // 2) DB 전체에서 이 주제와 가까운 아웃라이어
  const exclude = `AND v.video_id NOT IN (SELECT video_id FROM outlier_feed)
                   AND v.video_id NOT IN (SELECT video_id FROM dismissed_videos)
                   AND v.channel_id NOT IN (SELECT channel_id FROM hidden_channels)
                   AND v.format = 'long' AND v.published_at >= now() - interval '1 year'`;
  let rows: Array<{ video_id: string }>;
  if (hasGemini()) {
    const [e] = await embed([label], "query");
    rows = await q(
      `SELECT video_id FROM (
         SELECT v.video_id, v.ratio FROM videos v
          WHERE v.embedding IS NOT NULL AND v.ratio >= $2 ${exclude}
          ORDER BY v.embedding <=> $1::vector LIMIT ${PER_PATTERN * 3}) t
        ORDER BY ratio DESC LIMIT ${PER_PATTERN}`,
      [vec(e), MIN_RATIO],
    );
  } else {
    const words = label.split(/[\s,·]+/).filter((w) => w.length >= 2).slice(0, 6);
    rows = await q(
      `SELECT v.video_id FROM videos v
        WHERE v.ratio >= $1 ${exclude}
          AND (${words.map((_, i) => `v.title ILIKE $${i + 2}`).join(" OR ") || "false"})
        ORDER BY v.ratio DESC LIMIT ${PER_PATTERN}`,
      [MIN_RATIO, ...words.map((w) => `%${w}%`)],
    );
  }

  for (const r of rows) {
    await q("INSERT INTO outlier_feed (video_id, folder_id, pattern) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [
      r.video_id,
      folderId,
      label,
    ]);
  }
  return rows.length;
}

/**
 * 주간 배치. 연결 폴더마다 패턴을 (없으면 먼저 분석해서) 가져와 새 아웃라이어를 고른다.
 * 시간 예산을 넘기면 멈추고, 다음 실행이 이어서 한다.
 */
export async function runOutlierBatch(budgetMs = 240_000): Promise<{ added: number; patterns: number }> {
  const start = Date.now();
  let added = 0;
  let patterns = 0;

  for (const folderId of await connectedFolders()) {
    let labels = await q<{ label: string }>("SELECT label FROM patterns WHERE folder_id = $1 AND format = 'long' ORDER BY position", [folderId]);
    if (!labels.length && hasLLM()) {
      await runPatterns(folderId, "long").catch(() => 0);
      labels = await q("SELECT label FROM patterns WHERE folder_id = $1 AND format = 'long' ORDER BY position", [folderId]);
    }
    for (const { label } of labels) {
      if (Date.now() - start > budgetMs) return { added, patterns };
      added += await pickForPattern(folderId, label, NEW_CHANNELS_PER_PATTERN);
      patterns++;
    }
  }
  await setKv("outliersRefreshedAt", new Date().toISOString());
  return { added, patterns };
}
