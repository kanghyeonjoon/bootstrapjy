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

-- ── 최신성 · 결 (2026-10 추가) ────────────────────────────────
-- 레퍼런스 폴더와 결이 얼마나 비슷한 채널인가 (AI 판정 0~3, 폴더 채널은 3). NULL = 아직 안 봄
ALTER TABLE channels ADD COLUMN IF NOT EXISTS fit SMALLINT;
-- 마지막 RSS 확인 시각 (RSS 는 할당량 0 이라 자주 본다)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS rss_at TIMESTAMPTZ;
-- 뜨는 중 점수: 30일 안 된 영상의 하루 조회수 ÷ 채널의 보통 하루 조회수
ALTER TABLE videos ADD COLUMN IF NOT EXISTS rising REAL;
CREATE INDEX IF NOT EXISTS videos_rising_idx ON videos (rising DESC) WHERE rising IS NOT NULL;
-- 조회수 기록 (RSS 를 볼 때마다 한 줄). 며칠 쌓이면 진짜 증가 속도를 잰다
CREATE TABLE IF NOT EXISTS view_snapshots (
  video_id  TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  views     BIGINT NOT NULL,
  PRIMARY KEY (video_id, at)
);
-- 영상 찾기 결과의 묶음: proven(검증된 영상) | recent(최근 30일 · 뜨는 중)
ALTER TABLE find_hits ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'proven';
ALTER TABLE finds ADD COLUMN IF NOT EXISTS recent_status TEXT;

-- ── 세트 (2026-10 추가) ───────────────────────────────────────
-- 세트 = 내가 운영하는 개인 채널 하나 + 그 채널의 레퍼런스 폴더들. 분야가 다른 채널끼리 섞이지 않게
-- 아웃라이어·결 판정을 세트 단위로 따로 돈다. color 는 화면에서 세트를 구분하는 색 번호.
CREATE TABLE IF NOT EXISTS sets (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  my_channel_id  TEXT REFERENCES channels(channel_id) ON DELETE SET NULL,
  color          SMALLINT NOT NULL DEFAULT 0,
  position       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE folders ADD COLUMN IF NOT EXISTS set_id INT REFERENCES sets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS folders_set_idx ON folders (set_id);
-- 세트별 채널 결 점수 (0~3). 세트마다 기준이 다르니 채널 하나가 세트별로 다른 점수를 가진다
CREATE TABLE IF NOT EXISTS set_channel_fit (
  set_id      INT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  fit         SMALLINT NOT NULL,
  PRIMARY KEY (set_id, channel_id)
);
-- 세트별 아웃라이어 피드. 같은 영상이 여러 세트에 따로 들어갈 수 있다 (기존 outlier_feed 는 더 안 쓴다)
CREATE TABLE IF NOT EXISTS set_outlier_feed (
  set_id     INT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  folder_id  INT REFERENCES folders(id) ON DELETE SET NULL,
  pattern    TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, video_id)
);

-- ── 댓글 씨앗 (2026-10 추가) ──────────────────────────────────
-- 영상 댓글을 받아 농담·칭찬을 걸러내고 질문·반박·경험담·요청으로 묶은 결과. 영상당 한 줄, 다시 돌리면 덮어쓴다.
-- comments = 남긴 댓글 [{id, text, likes, replies, kind}], seeds = 댓글에서 뽑은 주제 [{topic, kind, ids}]
CREATE TABLE IF NOT EXISTS comment_digests (
  video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
  fetched     INT NOT NULL DEFAULT 0,
  comments    JSONB NOT NULL DEFAULT '[]',
  seeds       JSONB NOT NULL DEFAULT '[]',
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
