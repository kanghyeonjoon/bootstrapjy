/**
 * 대본 틀(framework). Vidoutliers 의 기본 틀을 그대로 옮겼다:
 * 썸네일·제목 → 인트로(확인·공감대) → 바디(결론·근거·증거) ×2.
 *
 * 블록은 두 종류다 — 섹션 제목(h)과, 체크할 수 있는 항목(item: 이름 + 힌트 + 본문).
 */

export type Block =
  | { id: string; type: "h"; text: string }
  | { id: string; type: "item"; label: string; hint: string; body: string; done: boolean };

let n = 0;
const id = () => `b${Date.now().toString(36)}${(n++).toString(36)}`;

const h = (text: string): Block => ({ id: id(), type: "h", text });
const item = (label: string, hint: string): Block => ({ id: id(), type: "item", label, hint, body: "", done: false });

const body = () => [h("바디"), item("결론", "하고 싶은 말"), item("근거", "근거"), item("증거", "사례, 권위, 숫자, 내 경험")];

export const DEFAULT_BLOCKS: Block[] = [
  h("썸네일·제목"),
  item("썸네일 키워드", "썸네일 핵심 키워드"),
  item("제목 키워드", "제목 핵심 키워드"),
  h("인트로"),
  item("확인", "확인 시켜주기"),
  item("공감대 형성", "시청자와 공감대 형성"),
  ...body(),
  ...body(),
];

export const newBlockId = id;
