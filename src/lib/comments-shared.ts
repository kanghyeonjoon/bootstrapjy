/** 댓글 씨앗 — 화면(클라이언트)과 서버가 같이 쓰는 갈래·타입. DB 를 부르지 않는다. */

export const COMMENT_KINDS = {
  question: { label: "질문", hint: "다음 영상 주제", color: "#4F7CC2" },
  debate: { label: "반박·논쟁", hint: "의견이 갈리는 지점", color: "#C2564F" },
  story: { label: "경험담", hint: "대본에 쓸 실제 사례·말투", color: "#7FA968" },
  request: { label: "요청", hint: "대놓고 원하는 주제", color: "#C29A3F" },
} as const;
export type CommentKind = keyof typeof COMMENT_KINDS;

export interface KeptComment {
  id: string;
  text: string;
  likes: number;
  replies: number;
  kind: CommentKind;
}
export interface Seed {
  topic: string;
  kind: CommentKind;
  /** 근거 댓글 id */
  ids: string[];
}
export interface CommentDigest {
  videoId: string;
  /** 받아 온 댓글 수 (0 이면 댓글 없음·막힘) */
  fetched: number;
  comments: KeptComment[];
  seeds: Seed[];
  error: string | null;
  createdAt: string;
}
