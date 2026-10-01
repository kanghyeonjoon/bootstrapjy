import { q } from "@/lib/db";

/** 카드 하나를 그리는 데 필요한 것 전부. 모든 목록 화면이 이 모양으로 받는다. */
export interface VideoCardData {
  videoId: string;
  channelId: string;
  title: string;
  titleKo: string | null;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  format: "long" | "short";
  thumbnailUrl: string | null;
  viewCount: number | null;
  ratio: number | null;
  saved: boolean;
  /** 분석이 끝난 영상이면 그 분석 id */
  analysisId: number | null;
  /** 이 채널이 내 폴더 어디에든 들어 있는가 ("폴더에 추가" 버튼을 숨긴다) */
  inFolder: boolean;
}

/** v = videos, c = channels 별칭을 쓰는 쿼리에 붙인다 */
export const CARD_COLUMNS = `
  v.video_id, v.channel_id, v.title, v.title_ko, c.title AS channel_title, v.published_at,
  v.duration_sec, v.format, v.thumbnail_url, v.view_count, v.ratio,
  EXISTS (SELECT 1 FROM saved_videos s WHERE s.video_id = v.video_id) AS saved,
  (SELECT a.id FROM analyses a WHERE a.video_id = v.video_id AND a.status = 'done'
    ORDER BY a.id DESC LIMIT 1) AS analysis_id,
  EXISTS (SELECT 1 FROM folder_channels fc WHERE fc.channel_id = v.channel_id) AS in_folder`;

interface CardRow {
  video_id: string;
  channel_id: string;
  title: string;
  title_ko: string | null;
  channel_title: string;
  published_at: Date | string;
  duration_sec: number;
  format: "long" | "short";
  thumbnail_url: string | null;
  view_count: string | number | null;
  ratio: number | null;
  saved: boolean;
  analysis_id: number | null;
  in_folder: boolean;
}

export function toCard(r: CardRow): VideoCardData {
  return {
    videoId: r.video_id,
    channelId: r.channel_id,
    title: r.title,
    titleKo: r.title_ko,
    channelTitle: r.channel_title,
    publishedAt: new Date(r.published_at).toISOString(),
    durationSec: r.duration_sec,
    format: r.format,
    thumbnailUrl: r.thumbnail_url,
    viewCount: r.view_count === null ? null : Number(r.view_count),
    ratio: r.ratio,
    saved: r.saved,
    analysisId: r.analysis_id,
    inFolder: r.in_folder,
  };
}

export async function cards(sql: string, params: unknown[] = []): Promise<VideoCardData[]> {
  return (await q<CardRow>(sql, params)).map(toCard);
}

export async function cardById(videoId: string): Promise<VideoCardData | null> {
  const r = await cards(
    `SELECT ${CARD_COLUMNS} FROM videos v JOIN channels c ON c.channel_id = v.channel_id WHERE v.video_id = $1`,
    [videoId],
  );
  return r[0] ?? null;
}
