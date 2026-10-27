import { hasLLM, llmJson } from "@/lib/ai";
import { embedPending, ingestVideos, isKorean, translatePending } from "@/lib/corpus";
import { getKv, q, setKv } from "@/lib/db";
import { runPatterns } from "@/lib/patterns";
import { searchOutliers } from "@/lib/search";
import { searchVideos } from "@/lib/youtube";
import { classifyChannelFit } from "@/lib/fit";

/** 결 판정 후, 그 세트와 결이 다른 채널(0~1점)에서 고른 영상은 세트 피드에서 뺀다 */
export async function pruneOffNiche(setId?: number): Promise<void> {
  await classifyChannelFit(400, setId).catch(() => 0);
  await q(
    `DELETE FROM set_outlier_feed o USING videos v, set_channel_fit s
      WHERE v.video_id = o.video_id AND s.set_id = o.set_id AND s.channel_id = v.channel_id AND s.fit < 2`,
  );
}

/**
 * 아웃라이어 탭 — 세트(개인 채널 + 레퍼런스 폴더들)의 "반복 주제(패턴)"를 기준으로, 영상 DB 전체에서
 * 그 주제로 크게 잘 된 영상을 골라 그 세트의 피드에 쌓는다. 세트끼리는 섞이지 않는다.
 *
 * 목적은 "내 분야에서, 내가 아직 모르는 채널까지 포함해 검증된 영상을 발견하는 것"이다.
 * 두 단계로 나눈다:
 *   pick   — 이미 쌓인 DB 에서 패턴별로 고른다. 몇 초면 끝난다 (화면에서 바로 보이게)
 *   expand — 패턴으로 유튜브를 훑어 새 채널을 DB 에 들인다. 느리니 뒤편(크론·after)에서만
 */

const PER_PATTERN = 12;
const MIN_RATIO = 2;
/** 1년을 넘긴 영상(최대 3년)은 배수가 이만큼 커야 들인다 */
const OLD_MIN_RATIO = 4;
/** 조회수가 너무 적은 영상은 배수만 커 보인다 */
const MIN_VIEWS = 3000;
/** 팟캐스트·강연 풀버전·오디오북은 레퍼런스가 안 된다 — 30분 넘는 영상은 뺀다 */
const MAX_SEC = 30 * 60;
/** 한 채널이 세트 피드를 채우지 못하게 */
const MAX_PER_CHANNEL = 2;
const NEW_CHANNELS_PER_PATTERN = 12;

/** 세트에 속한 폴더 (레퍼런스가 들어 있는 것만) */
export async function setFolders(setId: number): Promise<number[]> {
  const rows = await q<{ id: number }>(
    `SELECT f.id FROM folders f
      WHERE f.set_id = $1 AND EXISTS (SELECT 1 FROM folder_channels fc WHERE fc.folder_id = f.id)
      ORDER BY f.position, f.id`,
    [setId],
  );
  return rows.map((r) => r.id);
}

async function allSetIds(): Promise<number[]> {
  return (await q<{ id: number }>("SELECT id FROM sets ORDER BY position, id")).map((r) => r.id);
}

/** 내 채널의 잘 된 영상 제목 — 고를 때 "내 채널 분야" 기준으로 쓴다 */
async function myChannelContext(setId: number): Promise<string> {
  const r = await q<{ title: string; titles: string[] | null }>(
    `SELECT c.title,
            (SELECT array_agg(t) FROM (SELECT COALESCE(v.title_ko, v.title) AS t FROM videos v
               WHERE v.channel_id = c.channel_id ORDER BY v.ratio DESC NULLS LAST LIMIT 6) x) AS titles
       FROM sets s JOIN channels c ON c.channel_id = s.my_channel_id WHERE s.id = $1`,
    [setId],
  );
  return r[0] ? `내 채널: ${r[0].title}${r[0].titles?.length ? ` (잘 된 영상: ${r[0].titles.join(" / ")})` : ""}` : "";
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
"내 채널"이 주어지면 그 채널 시청자가 볼 만한 분야의 영상만 고른다.
팟캐스트·오디오북 요약·강연이나 인터뷰 풀버전, 브랜드 필름·광고 영상은 빼고 맞는 게 없으면 비운다.
"목표"가 주어지면 그 목표에 쓸 레퍼런스로 도움이 되는 영상만 고른다. 시청자가 목표와 다른 영상(예: 유튜버 지망생용 강의)은 제목·썸네일 포맷이 아주 좋은 경우가 아니면 뺀다.
출력은 JSON 하나만: {"ids":["영상ID", ...]}`;

/** 세트 하나의 패턴 하나로 DB 에서 고른다 — 유튜브는 건드리지 않는다 */
async function pickForPattern(setId: number, folderId: number, label: string, mine: string): Promise<number> {
  const sid = Number(setId);
  // 세트 목표(누구에게 파는 채널인가) + 폴더 목표(이 폴더를 무엇에 쓰는가) — kv 에 직접 적어 둔다
  const goal = [await getKv<string>(`outlierGoal:${sid}`, ""), await getKv<string>(`outlierFolderGoal:${folderId}`, "")]
    .filter(Boolean)
    .join(" ");
  const cands = await searchOutliers({
    texts: [label],
    minRatio: MIN_RATIO,
    limit: 40,
    // 이 세트와 결이 맞는 채널만 (아직 안 본 채널은 일단 두고, 결 판정이 끝나면 걸러진다).
    // 이미 이 세트 피드에 있는 영상은 뺀다 — 다른 세트 피드에 있는 건 상관없다.
    where: `v.video_id NOT IN (SELECT video_id FROM set_outlier_feed WHERE set_id = ${sid})
            AND (v.published_at >= now() - interval '1 year'
                 OR (v.published_at >= now() - interval '3 years' AND v.ratio >= ${OLD_MIN_RATIO}))
            AND v.view_count >= ${MIN_VIEWS}
            AND v.duration_sec <= ${MAX_SEC}
            AND v.title !~* '(오디오북|audiobook|팟캐스트|podcast)'
            AND (SELECT count(*) FROM set_outlier_feed f JOIN videos fv ON fv.video_id = f.video_id
                  WHERE f.set_id = ${sid} AND fv.channel_id = v.channel_id) < ${MAX_PER_CHANNEL}
            AND v.channel_id IS DISTINCT FROM (SELECT my_channel_id FROM sets WHERE id = ${sid})
            AND COALESCE((SELECT s.fit FROM set_channel_fit s WHERE s.set_id = ${sid} AND s.channel_id = c.channel_id), 2) >= 2`,
  });
  if (!cands.length) return 0;

  let ids = cands.slice(0, PER_PATTERN).map((c) => c.video_id);
  if (hasLLM()) {
    try {
      const list = cands.map((c) => `${c.video_id} | ${(c.ratio ?? 0).toFixed(1)}x | ${c.channel_title} | ${c.title_ko ?? c.title}`).join("\n");
      const out = await llmJson<{ ids: string[] }>(PICK, `${mine ? `${mine}\n` : ""}${goal ? `목표: ${goal}\n` : ""}주제: ${label}\n\n${list}`, {
        maxTokens: 800,
        lite: true,
      });
      const known = new Set(cands.map((c) => c.video_id));
      ids = [...new Set(out.ids ?? [])].filter((id) => known.has(id)).slice(0, PER_PATTERN);
    } catch {
      // AI 가 막히면 가까운 순 그대로
    }
  }
  if (ids.length) {
    // 같은 패턴 안에서도 한 채널이 상한을 넘지 않게 (위 조건은 이 묶음을 넣기 전의 개수만 본다)
    const have = await q<{ video_id: string; channel_id: string; n: number }>(
      `SELECT v.video_id, v.channel_id,
              (SELECT count(*)::int FROM set_outlier_feed f JOIN videos fv ON fv.video_id = f.video_id
                WHERE f.set_id = $2 AND fv.channel_id = v.channel_id) AS n
         FROM videos v WHERE v.video_id = ANY($1::text[])`,
      [ids, setId],
    );
    const info = new Map(have.map((r) => [r.video_id, r]));
    const used = new Map<string, number>();
    ids = ids.filter((id) => {
      const r = info.get(id);
      if (!r) return false;
      const n = (used.get(r.channel_id) ?? r.n) + 1;
      if (n > MAX_PER_CHANNEL) return false;
      used.set(r.channel_id, n);
      return true;
    });
  }
  if (ids.length) {
    await q(
      `INSERT INTO set_outlier_feed (set_id, video_id, folder_id, pattern)
       SELECT $2::int, id, $3::int, $4::text FROM unnest($1::text[]) AS id ON CONFLICT DO NOTHING`,
      [ids, setId, folderId, label],
    );
  }
  return ids.length;
}

/** 지금 고르기 — 이미 쌓인 DB 에서 세트의 패턴별로 고른다 (빠름). setId 를 안 주면 모든 세트 */
export async function pickOutliers(setId?: number): Promise<{ added: number; patterns: number }> {
  let added = 0;
  let patterns = 0;
  for (const sid of setId ? [setId] : await allSetIds()) {
    const mine = await myChannelContext(sid);
    for (const folderId of await setFolders(sid)) {
      for (const label of await patternsOf(folderId)) {
        added += await pickForPattern(sid, folderId, label, mine);
        patterns++;
      }
    }
    await setKv(`outliersRefreshedAt:${sid}`, new Date().toISOString());
  }
  return { added, patterns };
}

/** 패턴으로 유튜브를 훑어 새 채널을 DB 에 들인다 (느림 — 뒤편 전용) */
export async function expandOutliers(budgetMs: number, setId?: number): Promise<number> {
  const start = Date.now();
  let n = 0;
  for (const sid of setId ? [setId] : await allSetIds()) {
    for (const folderId of await setFolders(sid)) {
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
  }
  return n;
}

/**
 * 주간 배치 (크론): DB 를 넓히고 → 번역·임베딩 → 세트마다 새로 고른다.
 * 시간 예산을 넘기면 확장은 멈추지만 고르기는 항상 한다.
 */
export async function runOutlierBatch(budgetMs = 240_000): Promise<{ added: number; patterns: number }> {
  const start = Date.now();
  await expandOutliers(budgetMs * 0.5);
  await translatePending(150).catch(() => 0);
  await embedPending(270, Math.max(0, budgetMs * 0.8 - (Date.now() - start))).catch(() => 0);
  return pickOutliers();
}
