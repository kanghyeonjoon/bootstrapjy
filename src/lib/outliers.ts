import { hasLLM, llmJson } from "@/lib/ai";
import { embedPending, ingestVideos, isKorean, translatePending } from "@/lib/corpus";
import { getKv, q, setKv } from "@/lib/db";
import { runPatterns } from "@/lib/patterns";
import { searchOutliers } from "@/lib/search";
import { searchVideos } from "@/lib/youtube";

/**
 * 아웃라이어 탭 — 연결한 폴더의 "반복 주제(패턴)"를 기준으로, 영상 DB 전체에서
 * 그 주제로 크게 잘 된 영상을 골라 피드에 쌓는다.
 *
 * Vidoutliers 의 "폴더 연결" 모달 문구가 구조를 말해 준다:
 *   "폴더의 반복 주제(패턴)를 기준으로 골라요. 폴더 연결 변경은 다음 주부터 적용돼요."
 * 그래서 내 레퍼런스(명상·뇌과학)와 비슷한 영상만 나온다.
 *
 * 목적은 "내 분야에서, 내가 아직 모르는 채널까지 포함해 검증된 영상을 발견하는 것"이다.
 * 두 단계로 나눈다:
 *   pick   — 이미 쌓인 DB 에서 패턴별로 고른다. 몇 초면 끝난다 (화면에서 바로 보이게)
 *   expand — 패턴으로 유튜브를 훑어 새 채널을 DB 에 들인다. 느리니 뒤편(크론·after)에서만
 */

const PER_PATTERN = 12;
const MIN_RATIO = 2;
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
      WHERE EXISTS (SELECT 1 FROM folder_channels fc WHERE fc.folder_id = f.id)
      ORDER BY (SELECT COUNT(*) FROM folder_channels fc WHERE fc.folder_id = f.id) DESC, f.id`,
  );
  const ids = all.map((r) => r.id);
  const pinned = link.pinned.filter((id) => ids.includes(id));
  return [...pinned, ...ids.filter((id) => !pinned.includes(id))].slice(0, Math.max(AUTO_FOLDERS, pinned.length));
}

export async function setFolderLink(pinned: number[]): Promise<void> {
  await setKv("outlierFolders", { pinned });
}

/** 연결 폴더의 패턴. 아직 없으면 그 자리에서 분석한다 (AI 1회) */
async function patternsOf(folderId: number): Promise<string[]> {
  const get = async () =>
    (
      await q<{ label: string }>(
        "SELECT label FROM patterns WHERE folder_id = $1 AND format = 'long' ORDER BY position",
        [folderId],
      )
    ).map((r) => r.label);
  let labels = await get();
  if (!labels.length && hasLLM()) {
    await runPatterns(folderId, "long").catch(() => 0);
    labels = await get();
  }
  return labels;
}

const PICK = `너는 유튜브 레퍼런스 큐레이터다. 영상 주제(패턴) 하나와 후보 영상 목록을 받는다.
그 주제를 실제로 다루는 영상만 골라 관련도순으로 나열한다. 최대 12개, 같은 채널은 2편까지. 맞는 게 적으면 적게.
출력은 JSON 하나만: {"ids":["영상ID", ...]}`;

/** 패턴 하나로 DB 에서 고른다 — 유튜브는 건드리지 않는다 */
async function pickForPattern(folderId: number, label: string): Promise<number> {
  const cands = await searchOutliers({
    texts: [label],
    minRatio: MIN_RATIO,
    limit: 40,
    where: `v.video_id NOT IN (SELECT video_id FROM outlier_feed) AND v.published_at >= now() - interval '1 year'`,
  });
  if (!cands.length) return 0;

  let ids = cands.slice(0, PER_PATTERN).map((c) => c.video_id);
  if (hasLLM()) {
    try {
      const list = cands.map((c) => `${c.video_id} | ${c.ratio.toFixed(1)}x | ${c.channel_title} | ${c.title_ko ?? c.title}`).join("\n");
      const out = await llmJson<{ ids: string[] }>(PICK, `주제: ${label}\n\n${list}`, { maxTokens: 800, lite: true });
      const known = new Set(cands.map((c) => c.video_id));
      ids = [...new Set(out.ids ?? [])].filter((id) => known.has(id)).slice(0, PER_PATTERN);
    } catch {
      // AI 가 막히면 가까운 순 그대로
    }
  }
  if (ids.length) {
    await q(
      `INSERT INTO outlier_feed (video_id, folder_id, pattern)
       SELECT id, $2, $3 FROM unnest($1::text[]) AS id ON CONFLICT DO NOTHING`,
      [ids, folderId, label],
    );
  }
  return ids.length;
}

/** 지금 고르기 — 이미 쌓인 DB 에서 패턴별로 고른다 (빠름) */
export async function pickOutliers(): Promise<{ added: number; patterns: number }> {
  let added = 0;
  let patterns = 0;
  for (const folderId of await connectedFolders()) {
    for (const label of await patternsOf(folderId)) {
      added += await pickForPattern(folderId, label);
      patterns++;
    }
  }
  await setKv("outliersRefreshedAt", new Date().toISOString());
  return { added, patterns };
}

/** 패턴으로 유튜브를 훑어 새 채널을 DB 에 들인다 (느림 — 뒤편 전용) */
export async function expandOutliers(budgetMs: number): Promise<number> {
  const start = Date.now();
  let n = 0;
  for (const folderId of await connectedFolders()) {
    for (const label of await patternsOf(folderId)) {
      if (Date.now() - start > budgetMs) return n;
      const queries = hasLLM()
        ? await llmJson<{ q: string[] }>(
            '유튜브 영상 주제 하나를 받아, 같은 주제의 인기 영상을 찾을 유튜브 검색어 2개를 만든다. 한국어 하나, 영어 하나. {"q":["...","..."]} JSON 하나만.',
            label,
            { maxTokens: 300, lite: true },
          )
            .then((r) => r.q)
            .catch(() => [label])
        : [label];
      const found = (
        await Promise.all(
          queries.map((s) => searchVideos(s, isKorean(s) ? { lang: "ko", region: "KR" } : { lang: "en" }).catch(() => [])),
        )
      ).flat();
      await ingestVideos(found, { maxNewChannels: NEW_CHANNELS_PER_PATTERN });
      n++;
    }
  }
  return n;
}

/**
 * 주간 배치 (크론): DB 를 넓히고 → 번역·임베딩 → 새로 고른다.
 * 시간 예산을 넘기면 확장은 멈추지만 고르기는 항상 한다.
 */
export async function runOutlierBatch(budgetMs = 240_000): Promise<{ added: number; patterns: number }> {
  const start = Date.now();
  await expandOutliers(budgetMs * 0.5);
  await translatePending(150).catch(() => 0);
  await embedPending(270, Math.max(0, budgetMs * 0.8 - (Date.now() - start))).catch(() => 0);
  return pickOutliers();
}
