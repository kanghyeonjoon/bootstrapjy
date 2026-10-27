import { hasLLM, llmJson } from "@/lib/ai";
import { one, q } from "@/lib/db";
import { topComments } from "@/lib/youtube";

import { COMMENT_KINDS, type CommentDigest, type CommentKind, type KeptComment, type Seed } from "./comments-shared";

export * from "./comments-shared";

/**
 * 댓글 씨앗 — 영상 댓글에서 다음 영상 주제를 건진다.
 *
 * 좋아요 많은 댓글까지 전부(최대 200개) 받은 뒤 AI 가 농담·드립·칭찬·인사·광고를 버리고
 * 남은 것을 네 갈래로 나눈다. 제목은 이미 만들어진 영상을 보여 주지만, 댓글은 그 영상이
 * 채워 주지 못한 것을 보여 준다 — 새 주제는 거기서 나온다.
 */

interface Row {
  video_id: string;
  fetched: number;
  comments: KeptComment[];
  seeds: Seed[];
  error: string | null;
  created_at: string;
}
const toDigest = (r: Row): CommentDigest => ({
  videoId: r.video_id,
  fetched: r.fetched,
  comments: r.comments,
  seeds: r.seeds,
  error: r.error,
  createdAt: String(r.created_at),
});

export async function getDigest(videoId: string): Promise<CommentDigest | null> {
  const r = await one<Row>("SELECT * FROM comment_digests WHERE video_id = $1", [videoId]);
  return r ? toDigest(r) : null;
}

const KINDS = Object.keys(COMMENT_KINDS) as CommentKind[];

/** 댓글을 받아 거르고 묶어서 저장한다. Gemini 무료 한도를 아끼려고 버튼을 누를 때만 돈다. */
export async function buildDigest(videoId: string): Promise<CommentDigest> {
  if (!hasLLM()) throw new Error("댓글 분류에는 GEMINI_API_KEY 가 필요합니다 (무료).");
  const video = await one<{ title: string; title_ko: string | null }>(
    "SELECT title, title_ko FROM videos WHERE video_id = $1",
    [videoId],
  );
  if (!video) throw new Error("DB 에 없는 영상입니다.");

  const raw = await topComments(videoId);
  let comments: KeptComment[] = [];
  let seeds: Seed[] = [];
  let error: string | null = null;

  if (raw === null) error = "이 영상은 댓글을 막아 두었습니다.";
  else if (!raw.length) error = "댓글이 없습니다.";
  else {
    // 번호로 주고받는다 — 유튜브 댓글 id 는 길어서 출력 토큰만 잡아먹는다
    const out = await llmJson<{ keep?: Array<[number, string]>; seeds?: Array<{ topic: string; kind: string; ids: number[] }> }>(
      `유튜브 영상의 댓글 목록에서 다음 영상 기획에 쓸 만한 것만 남긴다.

버린다: 농담·드립·말장난, 칭찬·감사·응원("잘 봤어요", "최고"), 인사, 타임스탬프만 있는 것, 광고·홍보, 내용 없는 짧은 감탄, 채널 주인에 대한 사적인 말.
남긴다 (네 갈래):
- question: 영상이 답하지 않은 궁금증 ("그럼 ~는 어떻게 해요?")
- debate: 영상 내용에 반박하거나 다른 의견을 내는 것, 답글로 논쟁이 붙은 것
- story: 자기 경험·사례를 구체적으로 말하는 것
- request: 다뤄 달라고 직접 요청하는 주제
농담처럼 보여도 진짜 질문·반박이 담겨 있으면 남긴다. 애매하면 버린다.

그다음 남긴 댓글에서 "다음 영상 주제" 씨앗을 3~8개 뽑는다. 여러 댓글이 같은 말을 하면 하나로 묶고, 근거 댓글이 많은 것부터.
topic 은 한국어 한 문장, 영상 제목이 아니라 다룰 내용으로 쓴다 (예: "월세 사는 사람도 이 방법을 쓸 수 있는가").

출력은 JSON 하나만:
{"keep": [[댓글번호, "question|debate|story|request"], ...], "seeds": [{"topic": "...", "kind": "question|debate|story|request", "ids": [댓글번호, ...]}]}`,
      `영상 제목: ${video.title_ko ?? video.title}\n\n댓글 (번호 | 좋아요 | 답글 | 내용):\n${raw
        .map((c, i) => `${i} | ${c.likes} | ${c.replies} | ${c.text.replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n")}`,
      { maxTokens: 6000 },
    );

    const isKind = (k: string): k is CommentKind => (KINDS as string[]).includes(k);
    const kept = new Map<number, CommentKind>();
    for (const [i, k] of out.keep ?? []) if (raw[i] && isKind(k)) kept.set(i, k);
    comments = [...kept].map(([i, kind]) => ({ ...raw[i], kind }));
    seeds = (out.seeds ?? [])
      .filter((s) => s.topic && isKind(s.kind))
      .map((s) => ({
        topic: s.topic.trim(),
        kind: s.kind as CommentKind,
        ids: (s.ids ?? []).filter((i) => raw[i]).map((i) => raw[i].id),
      }));
  }

  const r = await one<Row>(
    `INSERT INTO comment_digests (video_id, fetched, comments, seeds, error, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (video_id) DO UPDATE SET fetched = excluded.fetched, comments = excluded.comments,
       seeds = excluded.seeds, error = excluded.error, created_at = now()
     RETURNING *`,
    [videoId, raw?.length ?? 0, JSON.stringify(comments), JSON.stringify(seeds), error],
  );
  return toDigest(r!);
}

/** 씨앗을 아이디어로 보낸다 (미분류 챕터). 근거 댓글 원문을 evidence 에 붙인다. */
export async function saveSeedAsIdea(videoId: string, seed: Seed, comments: KeptComment[]): Promise<void> {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const quotes = seed.ids
    .map((id) => byId.get(id))
    .filter((c): c is KeptComment => !!c)
    .slice(0, 3)
    .map((c) => `“${c.text.replace(/\s+/g, " ").slice(0, 160)}” (좋아요 ${c.likes})`);
  await q("INSERT INTO ideas (video_id, claim, evidence, memo) VALUES ($1, $2, $3, $4)", [
    videoId,
    seed.topic,
    quotes.join("\n") || null,
    `댓글 씨앗 · ${COMMENT_KINDS[seed.kind].label}`,
  ]);
}
