import { q } from "@/lib/db";

/**
 * 유튜브 Data API (공개 데이터만 읽는다).
 *
 * 인증은 둘 중 하나:
 * - YOUTUBE_API_KEY 가 있으면 키로 (가장 단순)
 * - 없으면 GOOGLE_CLIENT_ID/SECRET + YT_REFRESH_TOKEN 으로 OAuth
 *   (기존 '유튜브 대시보드'의 인증을 그대로 재사용한다)
 *
 * 모든 호출은 quota_log 에 유닛을 남긴다. 하루 10,000유닛.
 */

const BASE = "https://www.googleapis.com/youtube/v3";
export const DAILY_QUOTA = 10_000;
/** 이 길이 이하면 쇼츠로 본다. 2025년부터 쇼츠는 3분까지 허용된다. */
export const SHORT_MAX_SEC = 180;

export class YouTubeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`${message} (HTTP ${status})`);
  }
}

let token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.exp) return token.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: process.env.YT_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!body.access_token) throw new Error(`유튜브 인증 실패: ${body.error ?? res.status}`);
  token = { value: body.access_token, exp: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

type Params = Record<string, string | number | undefined>;

async function get<T>(endpoint: string, params: Params, units: number): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const headers: Record<string, string> = {};
  const key = process.env.YOUTUBE_API_KEY;
  if (key) qs.set("key", key);
  else headers.authorization = `Bearer ${await accessToken()}`;

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}/${endpoint}?${qs}`, { headers });
    if (res.ok) {
      await q("INSERT INTO quota_log (endpoint, units) VALUES ($1, $2)", [endpoint, units]);
      return (await res.json()) as T;
    }
    // 구글 쪽 일시 오류는 잠깐 쉬고 다시 보낸다
    if ([429, 500, 502, 503].includes(res.status) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      continue;
    }
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new YouTubeError(res.status, err.error?.message ?? endpoint);
  }
}

// ── 변환 ──────────────────────────────────────────────────────

export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

export const formatOf = (sec: number): "long" | "short" =>
  sec > 0 && sec <= SHORT_MAX_SEC ? "short" : "long";

/**
 * 실제로 파일이 있는 썸네일만, 큰 것부터.
 * 응답의 maxres 보다 큰 키(uhd·fhd 등)는 목록에 있어도 404 라 고르지 않는다.
 */
function bestThumb(t: Record<string, { url?: string }> | undefined): string | null {
  for (const k of ["maxres", "standard", "high", "medium", "default"]) {
    if (t?.[k]?.url) return t[k].url!;
  }
  return null;
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s));

/**
 * 문자 단위로 자르고, 깨진 문자를 고친다.
 * 그냥 .slice() 로 자르면 이모지·장식 글자(𝑯 같은 2칸짜리 문자)가 반으로 쪼개져
 * DB 가 그 묶음 전체를 거부한다 (2026-10 실제로 RSS 갱신이 통째로 멈췄던 원인).
 */
export function cleanText(s: string, max?: number): string {
  const whole = s.toWellFormed();
  return max === undefined ? whole : Array.from(whole).slice(0, max).join("");
}

export interface YtVideo {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSec: number;
  format: "long" | "short";
  thumbnailUrl: string | null;
  viewCount: number | null;
  lang: string | null;
}

interface RawVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
    thumbnails?: Record<string, { url?: string }>;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
}

function toVideo(v: RawVideo): YtVideo | null {
  const s = v.snippet;
  if (!s?.publishedAt || !s.channelId) return null;
  // 예정된 라이브·진행 중 라이브는 조회수가 의미 없다
  if (s.liveBroadcastContent && s.liveBroadcastContent !== "none") return null;
  const durationSec = parseDuration(v.contentDetails?.duration);
  return {
    videoId: v.id,
    channelId: s.channelId,
    channelTitle: s.channelTitle ?? "",
    title: cleanText(s.title ?? "(제목 없음)"),
    description: cleanText(s.description ?? "", 600),
    publishedAt: s.publishedAt,
    durationSec,
    format: formatOf(durationSec),
    thumbnailUrl: bestThumb(s.thumbnails),
    viewCount: num(v.statistics?.viewCount),
    lang: s.defaultAudioLanguage ?? s.defaultLanguage ?? null,
  };
}

// ── 호출 ──────────────────────────────────────────────────────

/** 50개당 1유닛 */
export async function videosByIds(ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get<{ items?: RawVideo[] }>(
      "videos",
      { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: 50 },
      1,
    );
    for (const it of r.items ?? []) {
      const v = toVideo(it);
      if (v) out.push(v);
    }
  }
  return out;
}

/** 키워드 검색 — 100유닛. 결과에 조회수가 없어서 videos 로 한 번 더 받는다(+1). */
export async function searchVideos(
  query: string,
  opts: {
    lang?: string;
    region?: string;
    order?: "relevance" | "viewCount";
    max?: number;
    /** 이 날짜 이후 올라온 영상만 (최근 30일 찾기) */
    publishedAfter?: string;
  } = {},
): Promise<YtVideo[]> {
  const r = await get<{ items?: Array<{ id?: { videoId?: string } }> }>(
    "search",
    {
      part: "snippet",
      q: query,
      type: "video",
      order: opts.order ?? "relevance",
      relevanceLanguage: opts.lang,
      regionCode: opts.region,
      publishedAfter: opts.publishedAfter,
      maxResults: opts.max ?? 50,
    },
    100,
  );
  const ids = (r.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
  return ids.length ? videosByIds(ids) : [];
}

export interface YtChannel {
  channelId: string;
  title: string;
  handle: string | null;
  avatarUrl: string | null;
  subs: number | null;
  uploadsPlaylistId: string | null;
  lang: string | null;
}

interface RawChannel {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    defaultLanguage?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

function toChannel(c: RawChannel): YtChannel {
  return {
    channelId: c.id,
    title: c.snippet?.title ?? "",
    handle: c.snippet?.customUrl ?? null,
    avatarUrl: c.snippet?.thumbnails?.medium?.url ?? c.snippet?.thumbnails?.default?.url ?? null,
    // 구독자 숨긴 채널은 0 이 아니라 모름이다
    subs: c.statistics?.hiddenSubscriberCount ? null : num(c.statistics?.subscriberCount),
    uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? null,
    lang: c.snippet?.defaultLanguage ?? null,
  };
}

const CHANNEL_PARTS = "snippet,statistics,contentDetails";

/** 50채널당 1유닛 */
export async function channelsByIds(ids: string[]): Promise<YtChannel[]> {
  const out: YtChannel[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get<{ items?: RawChannel[] }>(
      "channels",
      { part: CHANNEL_PARTS, id: ids.slice(i, i + 50).join(","), maxResults: 50 },
      1,
    );
    out.push(...(r.items ?? []).map(toChannel));
  }
  return out;
}

/** @핸들 하나 → 채널 (1유닛) */
export async function channelByHandle(handle: string): Promise<YtChannel | null> {
  const h = handle.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, "").replace(/^@?/, "@");
  const r = await get<{ items?: RawChannel[] }>("channels", { part: CHANNEL_PARTS, forHandle: h }, 1);
  return r.items?.[0] ? toChannel(r.items[0]) : null;
}

/** 채널 이름 검색 — 100유닛. 채널 추가 모달에서만 쓴다. */
export async function searchChannels(query: string): Promise<YtChannel[]> {
  const r = await get<{ items?: Array<{ id?: { channelId?: string } }> }>(
    "search",
    { part: "snippet", q: query, type: "channel", maxResults: 8 },
    100,
  );
  const ids = (r.items ?? []).map((i) => i.id?.channelId).filter((x): x is string => !!x);
  return ids.length ? channelsByIds(ids) : [];
}

/** 채널 최근 업로드 영상 ID (50개당 1유닛) */
export async function recentUploadIds(uploadsPlaylistId: string, max = 50): Promise<string[]> {
  const out: string[] = [];
  let pageToken: string | undefined;
  while (out.length < max) {
    const r = await get<{ items?: Array<{ contentDetails?: { videoId?: string } }>; nextPageToken?: string }>(
      "playlistItems",
      { part: "contentDetails", playlistId: uploadsPlaylistId, maxResults: 50, pageToken },
      1,
    );
    out.push(...(r.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, max);
}

export async function quotaToday(): Promise<number> {
  // 유튜브 할당량은 태평양 시간 자정에 초기화된다
  const rows = await q<{ n: string | null }>(
    `SELECT SUM(units)::text AS n FROM quota_log
      WHERE at >= (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')`,
  );
  return Number(rows[0]?.n ?? 0);
}
