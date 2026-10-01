// 레퍼런스 사이트 스키마 (Postgres). 로컬 PGlite·배포 Neon 모두 이 문자열 하나로 만든다.
// .ts 로 둔 건 배포 번들에 확실히 들어가게 하려고 — 런타임에 .sql 파일을 읽으면 빠질 수 있다.

export const SCHEMA_SQL = `
-- 레퍼런스 사이트 스키마. 로컬(PGlite)과 배포(Neon) 모두 이 파일 하나로 만든다.
-- 몇 번을 실행해도 같은 결과가 나오도록 전부 IF NOT EXISTS 다.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 채널 · 영상 코퍼스 ─────────────────────────────────────────
-- 코퍼스 = 영상 찾기·아웃라이어가 검색하는 "미리 쌓아 둔 영상"이다.
-- 폴더에 등록한 채널(source='folder')에서 시작해, 검색으로 발견한 채널
-- (source='discovered')로 계속 넓어진다.
CREATE TABLE IF NOT EXISTS channels (
  channel_id          TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  handle              TEXT,
  avatar_url          TEXT,
  subs                BIGINT,
  uploads_playlist_id TEXT,
  -- 배수의 분모. 롱폼·쇼츠를 따로 낸다 (최근 50편 중 7일 지난 것의 평균)
  avg_long            BIGINT,
  avg_short           BIGINT,
  source              TEXT NOT NULL DEFAULT 'discovered',
  lang                TEXT,
  crawled_at          TIMESTAMPTZ,
  crawl_error         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 받아 온 업로드 범위의 가장 오래된 게시일. 이보다 오래된 영상은 배수를 내지 않는다
ALTER TABLE channels ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS videos (
  video_id       TEXT PRIMARY KEY,
  channel_id     TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  -- 외국어 제목은 한국어 번역을 따로 둔다. 한국어 영상이면 NULL
  title_ko       TEXT,
  description    TEXT,
  published_at   TIMESTAMPTZ NOT NULL,
  duration_sec   INT NOT NULL DEFAULT 0,
  format         TEXT NOT NULL,                -- long | short
  thumbnail_url  TEXT,
  view_count     BIGINT,
  ratio          REAL,                         -- 조회수 ÷ 채널 평균(같은 포맷)
  lang           TEXT,
  embedding      vector(768),
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS videos_channel_idx ON videos (channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS videos_ratio_idx ON videos (ratio DESC);
-- 뜻 검색 색인. 영상이 수만 편이 돼도 후보 100개를 바로 꺼낸다
CREATE INDEX IF NOT EXISTS videos_embedding_idx ON videos USING hnsw (embedding vector_cosine_ops);

-- ── 폴더 (대시보드) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS folders (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folder_channels (
  folder_id   INT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, channel_id)
);

-- ── 패턴 분석 ─────────────────────────────────────────────────
-- 폴더의 아웃라이어에서 반복되는 주제. 아웃라이어 탭의 검색 기준이 된다.
CREATE TABLE IF NOT EXISTS patterns (
  id          SERIAL PRIMARY KEY,
  folder_id   INT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  format      TEXT NOT NULL,           -- long | short
  label       TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pattern_videos (
  pattern_id  INT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  PRIMARY KEY (pattern_id, video_id)
);

-- ── 아웃라이어 탭 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outlier_feed (
  video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  folder_id   INT REFERENCES folders(id) ON DELETE SET NULL,
  pattern     TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dismissed_videos (
  video_id    TEXT PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hidden_channels (
  channel_id  TEXT PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 영상 찾기 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finds (
  id           SERIAL PRIMARY KEY,
  prompt       TEXT NOT NULL,
  seed_video   TEXT,                   -- "비슷한 영상 찾기"로 시작했으면 그 영상
  intent       TEXT,
  queries      JSONB NOT NULL DEFAULT '[]',
  corpus_size  INT NOT NULL DEFAULT 0,
  candidates   INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'running',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS find_hits (
  find_id   INT NOT NULL REFERENCES finds(id) ON DELETE CASCADE,
  rank      INT NOT NULL,
  video_id  TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  PRIMARY KEY (find_id, rank)
);

-- ── 분석하기 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analyses (
  id          SERIAL PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued | transcript | summarizing | done | error
  hook_lines  JSONB,     -- [{text, tag}]
  hook_tags   JSONB,     -- ["궁금증 남기기", ...]
  claims      JSONB,     -- [{claim, evidence}]
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analyses_video_idx ON analyses (video_id);

-- ── 저장한 영상 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_topics (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS saved_videos (
  video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  topic_id    INT REFERENCES saved_topics(id) ON DELETE SET NULL,
  reason      TEXT,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 아이디어 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chapters (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ideas (
  id          SERIAL PRIMARY KEY,
  chapter_id  INT REFERENCES chapters(id) ON DELETE SET NULL,
  video_id    TEXT REFERENCES videos(video_id) ON DELETE SET NULL,
  claim       TEXT NOT NULL,
  evidence    TEXT,
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 대본 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scripts (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  ref_video_id  TEXT REFERENCES videos(video_id) ON DELETE SET NULL,
  blocks        JSONB NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 기타 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kv (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);
-- 유튜브 할당량 기록. 태평양 시간 자정에 초기화되지만 표시는 한국 날짜로 한다.
CREATE TABLE IF NOT EXISTS quota_log (
  id        SERIAL PRIMARY KEY,
  endpoint  TEXT NOT NULL,
  units     INT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 오래 걸리는 작업 (분석·패턴·주간 아웃라이어·채널 수집)
CREATE TABLE IF NOT EXISTS jobs (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  progress    TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
