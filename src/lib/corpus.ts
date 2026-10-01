import { claudeJson, embed, hasClaude, hasGemini } from "@/lib/ai";
import { one, q, vec } from "@/lib/db";
import {
  channelsByIds,
  recentUploadIds,
  videosByIds,
  YouTubeError,
  type YtChannel,
  type YtVideo,
} from "@/lib/youtube";

/**
 * 코퍼스 — 영상 찾기·아웃라이어가 검색하는 "미리 쌓아 둔 영상".
 *
 * Vidoutliers 는 전 사용자의 레퍼런스 채널로 7만 편 넘게 쌓아 두고 거기서 찾는다.
 * 혼자 쓰는 우리는 (1) 폴더에 등록한 채널과 (2) 검색하다 발견한 채널로 직접 키운다.
 *
 * 배수 = 조회수 ÷ 그 채널의 "보통 조회수"(같은 포맷끼리).
 * 보통 조회수는 같은 포맷 최근 30편(7일 지난 것)의 **중간값**이다. 막 올라온 영상은
 * 아직 조회수가 덜 차서 빼고, 평균 대신 중간값을 쓰는 건 대박 몇 편이 분모를 부풀리기 때문이다.
 * 2026-10 Vidoutliers 배수를 역산해 맞춘 공식이다 (평균 50편: 10.8x → 이 공식: 16.8x, 실제 16.1x).
 */

const MATURE_MS = 7 * 86_400_000;
const BASELINE_N = 30;
/** 채널을 다시 긁는 주기 */
const RECRAWL_MS = 20 * 3_600_000;

export const isKorean = (s: string) => /[가-힣]/.test(s);

export async function upsertChannels(list: YtChannel[], source: "folder" | "discovered"): Promise<void> {
  for (const c of list) {
    await q(
      `INSERT INTO channels (channel_id, title, handle, avatar_url, subs, uploads_playlist_id, lang, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (channel_id) DO UPDATE SET
         title = excluded.title,
         handle = COALESCE(excluded.handle, channels.handle),
         avatar_url = COALESCE(excluded.avatar_url, channels.avatar_url),
         subs = excluded.subs,
         uploads_playlist_id = COALESCE(excluded.uploads_playlist_id, channels.uploads_playlist_id),
         -- 한 번 폴더 채널이면 발견 채널로 내려가지 않는다
         source = CASE WHEN channels.source = 'folder' THEN 'folder' ELSE excluded.source END`,
      [c.channelId, c.title, c.handle, c.avatarUrl, c.subs, c.uploadsPlaylistId, c.lang, source],
    );
  }
}

/** 같은 포맷의 최근 30편(7일 지난 것) 조회수 중간값 */
function average(videos: YtVideo[], format: "long" | "short"): number | null {
  const cutoff = Date.now() - MATURE_MS;
  const views = videos
    .filter((v) => v.format === format && v.viewCount !== null)
    .filter((v) => new Date(v.publishedAt).getTime() < cutoff)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, BASELINE_N)
    .map((v) => v.viewCount!)
    .sort((a, b) => a - b);
  // 표본이 너무 적으면 기준이 아니라 우연이다
  return median(views);
}

function median(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.max(1, s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2));
}

type RatioOf = (v: YtVideo) => number | null;

async function saveVideos(videos: YtVideo[], ratioOf: RatioOf) {
  for (const v of videos) {
    const ratio = ratioOf(v);
    await q(
      `INSERT INTO videos (video_id, channel_id, title, description, published_at, duration_sec,
                           format, thumbnail_url, view_count, ratio, lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (video_id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         thumbnail_url = COALESCE(excluded.thumbnail_url, videos.thumbnail_url),
         view_count = excluded.view_count,
         ratio = COALESCE(excluded.ratio, videos.ratio),
         updated_at = now()`,
      [
        v.videoId,
        v.channelId,
        v.title,
        v.description,
        v.publishedAt,
        v.durationSec,
        v.format,
        v.thumbnailUrl,
        v.viewCount,
        ratio,
        isKorean(v.title) ? "ko" : (v.lang ?? "other"),
      ],
    );
  }
}

/**
 * 채널 하나를 긁는다 — 4유닛 (업로드 목록 2페이지 + 영상 정보 2번).
 * 최근 100편을 받아 기준 조회수를 다시 내고, 영상과 배수를 저장한다.
 */
export async function crawlChannel(channelId: string): Promise<number> {
  const ch = await one<{ uploads_playlist_id: string | null }>(
    "SELECT uploads_playlist_id FROM channels WHERE channel_id = $1",
    [channelId],
  );
  if (!ch?.uploads_playlist_id) return 0;

  try {
    const ids = await recentUploadIds(ch.uploads_playlist_id, 100);
    const videos = ids.length ? await videosByIds(ids) : [];
    const avg = { long: average(videos, "long"), short: average(videos, "short") };
    const oldest = videos.reduce<string | null>((m, v) => (!m || v.publishedAt < m ? v.publishedAt : m), null);
    await q(
      `UPDATE channels SET avg_long = $2, avg_short = $3, window_start = $4, crawled_at = now(), crawl_error = NULL
        WHERE channel_id = $1`,
      [channelId, avg.long, avg.short, oldest],
    );
    await saveVideos(videos, (v) => {
      const base = v.format === "long" ? avg.long : avg.short;
      return base && v.viewCount !== null ? v.viewCount / base : null;
    });
    // 받아 온 범위(최근 100편)보다 오래된 영상은 배수를 내지 않는다. 몇 년 전 영상을 지금 채널
    // 체급과 비교하면 수천 배가 나온다 (2026-10 실측: 6,889x). Vidoutliers 도 최근 영상만 잰다.
    if (oldest) {
      await q("UPDATE videos SET ratio = NULL WHERE channel_id = $1 AND published_at < $2", [channelId, oldest]);
    }
    return videos.length;
  } catch (e) {
    // 업로드 목록이 비공개이거나 채널이 사라졌다. 이유를 남기고 넘어간다
    const msg = e instanceof YouTubeError ? `HTTP ${e.status}` : (e as Error).message;
    await q("UPDATE channels SET crawled_at = now(), crawl_error = $2 WHERE channel_id = $1", [channelId, msg]);
    return 0;
  }
}

/**
 * 검색 결과처럼 채널을 아직 모르는 영상들을 코퍼스에 넣는다.
 * 새 채널은 발견 채널로 등록하고 긁어서 기준 조회수를 낸다 (채널당 4유닛).
 */
export async function ingestVideos(videos: YtVideo[], opts: { maxNewChannels?: number } = {}): Promise<void> {
  const channelIds = [...new Set(videos.map((v) => v.channelId))];
  if (channelIds.length === 0) return;

  const known = new Set(
    (
      await q<{ channel_id: string; crawled_at: Date | null }>(
        "SELECT channel_id, crawled_at FROM channels WHERE channel_id = ANY($1)",
        [channelIds],
      )
    )
      .filter((r) => r.crawled_at && Date.now() - new Date(r.crawled_at).getTime() < 7 * 86_400_000)
      .map((r) => r.channel_id),
  );
  const fresh = channelIds.filter((id) => !known.has(id)).slice(0, opts.maxNewChannels ?? 80);
  if (fresh.length) {
    await upsertChannels(await channelsByIds(fresh), "discovered");
    await pool(fresh, 6, (id) => crawlChannel(id));
  }

  // 평균을 이미 아는 채널의 영상은 검색 결과 그대로 넣는다 (최신 조회수 반영)
  const rows = await q<{ channel_id: string; avg_long: string | null; avg_short: string | null; window_start: Date | null }>(
    "SELECT channel_id, avg_long, avg_short, window_start FROM channels WHERE channel_id = ANY($1)",
    [channelIds],
  );
  const ch = new Map(rows.map((r) => [r.channel_id, r]));
  await saveVideos(
    videos.filter((v) => ch.has(v.channelId)),
    (v) => {
      const c = ch.get(v.channelId)!;
      // 받아 온 범위 밖(더 오래된) 영상은 그 시절 기준을 모른다
      if (!c.window_start || new Date(v.publishedAt) < new Date(c.window_start)) return null;
      const base = Number(v.format === "long" ? c.avg_long : c.avg_short);
      return base && v.viewCount !== null ? v.viewCount / base : null;
    },
  );
}

/** 동시에 n개씩 돌린다 */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ── 번역 · 임베딩 (키가 있을 때만) ────────────────────────────

/** 외국어 제목을 한국어로. Vidoutliers 처럼 번역 제목 + 원제를 같이 보여 준다. */
export async function translatePending(limit = 80): Promise<number> {
  if (!hasClaude()) return 0;
  const rows = await q<{ video_id: string; title: string }>(
    `SELECT video_id, title FROM videos WHERE lang <> 'ko' AND title_ko IS NULL
      ORDER BY ratio DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  if (!rows.length) return 0;
  const out = await claudeJson<Record<string, string>>(
    "유튜브 영상 제목을 자연스러운 한국어로 번역한다. 고유명사·인명은 한국어 표기로. 출력은 {\"영상ID\": \"번역\"} JSON 하나만.",
    rows.map((r) => `${r.video_id}\t${r.title}`).join("\n"),
    6000,
  );
  for (const r of rows) {
    if (out[r.video_id]) await q("UPDATE videos SET title_ko = $2 WHERE video_id = $1", [r.video_id, out[r.video_id]]);
  }
  return rows.length;
}

export function embedText(v: { title: string; title_ko?: string | null; description?: string | null }): string {
  return [v.title_ko, v.title, (v.description ?? "").slice(0, 300)].filter(Boolean).join("\n");
}

/** 아직 벡터가 없는 영상에 임베딩을 붙인다 */
export async function embedPending(limit = 500): Promise<number> {
  if (!hasGemini()) return 0;
  const rows = await q<{ video_id: string; title: string; title_ko: string | null; description: string | null }>(
    `SELECT video_id, title, title_ko, description FROM videos
      WHERE embedding IS NULL ORDER BY ratio DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  if (!rows.length) return 0;
  const vecs = await embed(rows.map(embedText));
  for (let i = 0; i < rows.length; i++) {
    if (vecs[i]) await q("UPDATE videos SET embedding = $2 WHERE video_id = $1", [rows[i].video_id, vec(vecs[i])]);
  }
  return rows.length;
}

// ── 매일 갱신 ─────────────────────────────────────────────────

/**
 * 오래된 채널부터 다시 긁는다. 폴더 채널이 먼저다.
 * 시간 예산 안에서만 돌고 멈춘다 (Vercel 함수는 한 번에 최대 300초).
 */
export async function refreshCorpus(budgetMs = 240_000): Promise<{ channels: number; videos: number }> {
  const start = Date.now();
  const due = await q<{ channel_id: string }>(
    `SELECT channel_id FROM channels
      WHERE uploads_playlist_id IS NOT NULL
        AND (crawled_at IS NULL OR crawled_at < now() - ($1 || ' milliseconds')::interval)
      ORDER BY (source = 'folder') DESC, crawled_at NULLS FIRST
      LIMIT 400`,
    [String(RECRAWL_MS)],
  );
  let channels = 0;
  let videos = 0;
  for (const { channel_id } of due) {
    if (Date.now() - start > budgetMs) break;
    videos += await crawlChannel(channel_id);
    channels += 1;
  }
  if (Date.now() - start < budgetMs) await translatePending().catch(() => 0);
  if (Date.now() - start < budgetMs) await embedPending().catch(() => 0);
  return { channels, videos };
}

export async function corpusSize(): Promise<number> {
  const r = await one<{ n: string }>("SELECT COUNT(*)::text AS n FROM videos");
  return Number(r?.n ?? 0);
}
