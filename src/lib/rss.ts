import { isKorean, pool } from "@/lib/corpus";
import { getKv, q, setKv } from "@/lib/db";
import { cleanText } from "@/lib/youtube";

/**
 * 유튜브 채널 RSS — 할당량 0, 0.3초. 최근 영상 15개의 제목·게시일·조회수·썸네일을 준다.
 * (2026-10 실측: https://www.youtube.com/feeds/videos.xml?channel_id=… 에 media:statistics views 포함)
 *
 * 이걸로 두 가지를 한다:
 *   1. 아는 채널 전부의 새 영상·조회수를 하루 여러 번 반영 (sweepRss)
 *   2. 처음 보는 채널의 "보통 조회수"를 그 자리에서 낸다 (rssBaseline) — 최근 30일 찾기에서
 * 유튜브 API 는 길이(롱폼/쇼츠) 같은 세부를 채울 때만 밤에 쓴다.
 */

const MATURE_MS = 7 * 86_400_000;
/** 마지막 전체 확인 후 이만큼 지나면 다시 돈다 */
const SWEEP_EVERY_MS = 3 * 3_600_000;

export interface RssVideo {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  views: number | null;
  thumbnailUrl: string | null;
  format: "long" | "short";
}

const unxml = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export async function fetchFeed(channelId: string): Promise<RssVideo[] | null> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const xml = await res.text();
  const channelTitle = unxml(/<author>\s*<name>([^<]*)<\/name>/.exec(xml)?.[1] ?? "");
  return xml
    .split("<entry>")
    .slice(1)
    .map((e) => {
      const pick = (re: RegExp) => re.exec(e)?.[1] ?? "";
      const link = pick(/<link rel="alternate" href="([^"]+)"/);
      const views = pick(/<media:statistics views="(\d+)"/);
      return {
        videoId: pick(/<yt:videoId>([^<]+)<\/yt:videoId>/),
        channelId,
        channelTitle,
        title: cleanText(unxml(pick(/<title>([^<]*)<\/title>/))),
        description: cleanText(unxml(pick(/<media:description>([\s\S]*?)<\/media:description>/)), 600),
        publishedAt: pick(/<published>([^<]+)<\/published>/),
        views: views ? Number(views) : null,
        thumbnailUrl: pick(/<media:thumbnail url="([^"]+)"/) || null,
        // RSS 에는 길이가 없다. 쇼츠는 링크가 /shorts/ 로 온다
        format: link.includes("/shorts/") ? ("short" as const) : ("long" as const),
      };
    })
    .filter((v) => v.videoId && v.publishedAt);
}

function median(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.max(1, s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2));
}

/** RSS 15편으로 낸 보통 조회수 (7일 지난 영상의 중간값, 포맷별). 처음 보는 채널에 쓴다 */
export function rssBaseline(items: RssVideo[]): { long: number | null; short: number | null } {
  const cutoff = Date.now() - MATURE_MS;
  const of = (f: "long" | "short") =>
    median(items.filter((v) => v.format === f && v.views !== null && new Date(v.publishedAt).getTime() < cutoff).map((v) => v.views!));
  return { long: of("long"), short: of("short") };
}

/** RSS 로 받은 영상을 DB 에 넣거나 조회수를 갱신한다. 조회수 기록도 한 줄씩 남긴다 */
export async function saveRssVideos(items: RssVideo[]): Promise<void> {
  if (!items.length) return;
  const rows = items.map((v) => ({
    video_id: v.videoId,
    channel_id: v.channelId,
    title: v.title,
    description: v.description,
    published_at: v.publishedAt,
    format: v.format,
    thumbnail_url: v.thumbnailUrl,
    view_count: v.views,
    lang: isKorean(v.title) ? "ko" : "other",
  }));
  await q(
    `INSERT INTO videos (video_id, channel_id, title, description, published_at, duration_sec, format,
                         thumbnail_url, view_count, ratio, lang)
     SELECT r.video_id, r.channel_id, r.title, r.description, r.published_at, 0, r.format,
            r.thumbnail_url, r.view_count,
            r.view_count::real / NULLIF(CASE r.format WHEN 'long' THEN c.avg_long ELSE c.avg_short END, 0),
            r.lang
       FROM jsonb_to_recordset($1::jsonb) AS r(video_id text, channel_id text, title text, description text,
              published_at timestamptz, format text, thumbnail_url text, view_count bigint, lang text)
       JOIN channels c ON c.channel_id = r.channel_id
     ON CONFLICT (video_id) DO UPDATE SET
       view_count = COALESCE(excluded.view_count, videos.view_count),
       ratio = COALESCE(excluded.ratio, videos.ratio),
       updated_at = now()`,
    [JSON.stringify(rows)],
  );
  await q(
    `INSERT INTO view_snapshots (video_id, views)
     SELECT r.video_id, r.view_count FROM jsonb_to_recordset($1::jsonb) AS r(video_id text, view_count bigint)
      WHERE r.view_count IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(rows)],
  );
}

/**
 * 뜨는 중 점수 — "이 나이의 보통 영상이라면 몇 회쯤일까" 대비 실제 조회수.
 *
 * 30일 안 된 영상은 조회수가 아직 덜 쌓여서 "보통 조회수의 2배"로는 안 잡힌다.
 * 그렇다고 하루 조회수로 비교하면 조회수가 첫 며칠에 몰리는 탓에 새 영상이 전부 부풀려진다
 * (2026-10 실측: 그렇게 하니 3,238편이 "뜨는 중" — 쓸모없음).
 * 그래서 채널의 보통 조회수(7일 지난 영상 중간값)에 "그 나이까지 보통 쌓이는 비율"을 곱해
 * 기대 조회수를 만들고, 실제 조회수를 그것과 비교한다.
 *   쌓이는 비율 ≈ 0.35 + 0.18·ln(경과일)  → 1일 35%, 3일 55%, 7일 70%, 14일 82%, 30일 96%
 * 조회수 기록(view_snapshots)이 며칠 쌓이면 실제 증가 속도로 바꿀 수 있다.
 */
export async function updateRising(channelIds?: string[]): Promise<void> {
  const only = channelIds?.length ? "AND v.channel_id = ANY($1)" : "";
  const params = channelIds?.length ? [channelIds] : [];
  await q(
    `UPDATE videos v
        SET rising = v.view_count::real / NULLIF(
              (CASE v.format WHEN 'long' THEN c.avg_long ELSE c.avg_short END)
              * LEAST(1, GREATEST(0.08, 0.35 + 0.18 * ln(GREATEST(EXTRACT(EPOCH FROM now() - v.published_at) / 86400, 0.25)))), 0)
       FROM channels c
      WHERE c.channel_id = v.channel_id
        AND v.published_at > now() - interval '30 days' AND v.view_count IS NOT NULL ${only}`,
    params,
  );
  await q(`UPDATE videos SET rising = NULL WHERE rising IS NOT NULL AND published_at <= now() - interval '30 days'`);
}

/**
 * 아는 채널 전부를 RSS 로 훑는다 (할당량 0). 12개씩 동시에, 시간 예산 안에서.
 * 오래 안 본 채널부터 본다.
 */
export async function sweepRss(budgetMs = 60_000): Promise<{ channels: number; videos: number }> {
  const start = Date.now();
  const chans = await q<{ channel_id: string }>(
    `SELECT channel_id FROM channels WHERE COALESCE(fit, 1) > 0
      ORDER BY (source = 'folder') DESC, rss_at NULLS FIRST LIMIT 1500`,
  );
  let channels = 0;
  let videos = 0;
  const done: string[] = [];
  await pool(chans, 12, async ({ channel_id }) => {
    if (Date.now() - start > budgetMs) return;
    try {
      const items = await fetchFeed(channel_id);
      if (!items) return;
      await saveRssVideos(items);
      done.push(channel_id);
      channels++;
      videos += items.length;
    } catch (e) {
      // 한 채널이 실패해도 나머지는 계속한다
      console.error("[rss]", channel_id, (e as Error).message.slice(0, 120));
    }
  });
  if (done.length) {
    await q("UPDATE channels SET rss_at = now() WHERE channel_id = ANY($1)", [done]);
    await updateRising();
  }
  return { channels, videos };
}

/** 마지막 RSS 확인이 3시간 넘었으면 다시 돈다 — 사이트를 쓰는 동안 뒤편에서 */
export async function maybeSweepRss(): Promise<void> {
  const last = await getKv<string | null>("rssSweepAt", null);
  if (last && Date.now() - new Date(last).getTime() < SWEEP_EVERY_MS) return;
  await setKv("rssSweepAt", new Date().toISOString()); // 먼저 적어서 동시에 두 번 돌지 않게
  await sweepRss(90_000).catch((e) => console.error("[rss] 실패", e));
}
