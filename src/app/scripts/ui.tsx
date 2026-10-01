"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Modal } from "@/app/dashboard/ui";
import { IconCheck, IconX } from "@/components/icons";
import { toast } from "@/components/Toast";
import { Thumb } from "@/components/VideoCard";
import { newBlockId, type Block } from "@/lib/scripts";
import { clearRef, createScript, deleteScript, extractTone, getTone, saveScript, saveTone } from "./actions";

export function NewScript() {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      disabled={busy}
      onClick={() => start(async () => router.push(`/scripts/${await createScript()}`))}
      className="rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper"
    >
      + 새 framework
    </button>
  );
}

export function DeleteScript({ id, title }: { id: number; title: string }) {
  const [, start] = useTransition();
  return (
    <button
      onClick={() => confirm(`'${title}' 대본을 지울까요?`) && start(() => deleteScript(id))}
      className="text-[12px] text-faint hover:text-red-600"
    >
      삭제
    </button>
  );
}

// ── 편집기 ────────────────────────────────────────────────────

type Item = Extract<Block, { type: "item" }>;

export function Editor({
  id,
  initialTitle,
  initialBlocks,
  refVideo,
}: {
  id: number;
  initialTitle: string;
  initialBlocks: Block[];
  refVideo: { id: string; title: string; thumb: string | null } | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [saved, setSaved] = useState(true);
  const [askOpen, setAskOpen] = useState(false);
  const [, start] = useTransition();
  const first = useRef(true);

  // 입력이 멈추고 0.7초 뒤 자동 저장
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(false);
    const t = setTimeout(() => saveScript(id, title, blocks).then(() => setSaved(true)), 700);
    return () => clearTimeout(t);
  }, [id, title, blocks]);

  const update = (bid: string, patch: Partial<Item> & Partial<{ text: string }>) =>
    setBlocks((bs) => bs.map((b) => (b.id === bid ? ({ ...b, ...patch } as Block) : b)));
  const remove = (bid: string) => setBlocks((bs) => bs.filter((b) => b.id !== bid));
  const insertAfter = (bid: string, b: Block) =>
    setBlocks((bs) => {
      const i = bs.findIndex((x) => x.id === bid);
      return [...bs.slice(0, i + 1), b, ...bs.slice(i + 1)];
    });
  const move = (bid: string, d: -1 | 1) =>
    setBlocks((bs) => {
      const i = bs.findIndex((x) => x.id === bid);
      const j = i + d;
      if (j < 0 || j >= bs.length) return bs;
      const n = [...bs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const items = blocks.filter((b): b is Item => b.type === "item");
  const doneN = items.filter((b) => b.done).length;

  const plain = () =>
    blocks
      .map((b) => (b.type === "h" ? `\n## ${b.text}` : `[${b.label}]\n${b.body || ""}`))
      .join("\n")
      .trim();

  return (
    <div className="px-4 py-5 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <div className="flex items-center gap-3">
          <Link href="/scripts" className="text-sub hover:text-ink">
            ← 대본 목록
          </Link>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-48 bg-transparent font-semibold outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setAskOpen(true)} className="rounded-lg px-2.5 py-1.5 font-semibold hover:bg-hover/5">
            AI에게 부탁하기
          </button>
          <button
            onClick={() => (navigator.clipboard.writeText(plain()), toast("대본을 복사했습니다"))}
            className="rounded-lg px-2.5 py-1.5 hover:bg-hover/5"
          >
            전체 복사
          </button>
          <button
            onClick={() =>
              confirm("작성한 내용을 모두 지울까요? 틀(섹션·항목)은 남습니다.") &&
              setBlocks((bs) => bs.map((b) => (b.type === "item" ? { ...b, body: "", done: false } : b)))
            }
            className="rounded-lg px-2.5 py-1.5 text-sub hover:bg-hover/5"
          >
            전체 지우기
          </button>
          <span className="w-12 text-right text-faint">{saved ? "저장됨" : "저장 중"}</span>
        </div>
      </div>

      <div className="mx-auto mt-6 grid max-w-[1000px] gap-10 lg:grid-cols-[1fr_220px]">
        <div className="min-w-0 max-w-[620px]">
          {refVideo && (
            <div className="group relative mb-6 w-64">
              <a href={`https://www.youtube.com/watch?v=${refVideo.id}`} target="_blank" rel="noreferrer">
                <div className="aspect-video overflow-hidden rounded-xl bg-line/50">
                  <Thumb id={refVideo.id} src={refVideo.thumb} eager />
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium">{refVideo.title}</p>
              </a>
              <button
                onClick={() => start(() => clearRef(id))}
                aria-label="레퍼런스 영상 빼기"
                className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/60 p-1 text-white group-hover:block"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {blocks.map((b, i) => (
            <div key={b.id} id={b.id} className="group relative">
              <BlockTools
                onAddItem={() => insertAfter(b.id, { id: newBlockId(), type: "item", label: "새 항목", hint: "", body: "", done: false })}
                onAddSection={() => insertAfter(b.id, { id: newBlockId(), type: "h", text: "새 섹션" })}
                onUp={() => move(b.id, -1)}
                onDown={() => move(b.id, 1)}
                onDelete={() => remove(b.id)}
              />
              {b.type === "h" ? (
                <input
                  value={b.text}
                  onChange={(e) => update(b.id, { text: e.target.value })}
                  className={`w-full bg-transparent text-[19px] font-bold outline-none ${i ? "mt-7" : ""} mb-2`}
                />
              ) : (
                <div className="mb-3 flex gap-2.5">
                  <input
                    type="checkbox"
                    checked={b.done}
                    onChange={(e) => update(b.id, { done: e.target.checked })}
                    className="mt-1 h-4 w-4 shrink-0 accent-current"
                  />
                  <div className="min-w-0 flex-1">
                    <input
                      value={b.label}
                      onChange={(e) => update(b.id, { label: e.target.value })}
                      className={`w-full bg-transparent text-[13.5px] font-semibold outline-none ${b.done ? "text-faint line-through" : ""}`}
                    />
                    <AutoText value={b.body} placeholder={b.hint} onChange={(v) => update(b.id, { body: v })} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="sticky top-6 hidden h-fit text-[12px] lg:block">
          <div className="flex justify-between text-faint">
            <span>목차</span>
            <span>
              완료 {doneN} / {items.length}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {blocks.map((b) => (
              <li key={b.id}>
                <a
                  href={`#${b.id}`}
                  className={`flex items-center gap-1.5 hover:text-ink ${b.type === "h" ? "mt-2 font-semibold" : "pl-3 text-sub"}`}
                >
                  {b.type === "item" ? (
                    <span className={`flex h-3 w-3 items-center justify-center rounded-full border ${b.done ? "border-ink bg-ink text-paper" : "border-line"}`}>
                      {b.done && <IconCheck className="h-2 w-2" />}
                    </span>
                  ) : (
                    <span className="h-3 w-3 rounded-full border border-line" />
                  )}
                  {b.type === "h" ? b.text : b.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {askOpen && <AskAi blocks={blocks} refVideo={refVideo} onClose={() => setAskOpen(false)} />}
    </div>
  );
}

function BlockTools(p: { onAddItem: () => void; onAddSection: () => void; onUp: () => void; onDown: () => void; onDelete: () => void }) {
  const btn = "rounded px-1 text-[11px] text-faint hover:bg-hover/5 hover:text-ink";
  return (
    <div className="absolute -left-2 top-0 hidden -translate-x-full items-center gap-0.5 group-hover:flex">
      <button className={btn} onClick={p.onAddItem} title="아래에 항목 추가">
        +
      </button>
      <button className={btn} onClick={p.onAddSection} title="아래에 섹션 추가">
        §
      </button>
      <button className={btn} onClick={p.onUp} title="위로">
        ↑
      </button>
      <button className={btn} onClick={p.onDown} title="아래로">
        ↓
      </button>
      <button className={btn} onClick={p.onDelete} title="삭제">
        ×
      </button>
    </div>
  );
}

function AutoText({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className="mt-0.5 w-full resize-none overflow-hidden bg-transparent text-[13.5px] leading-relaxed outline-none placeholder:text-faint"
    />
  );
}

/**
 * AI에게 부탁하기 — Vidoutliers 와 같이 "프롬프트로 복사"해서 ChatGPT·Claude 에 붙여 넣는 방식.
 * 썸네일 문구·제목 + 내 말투 + 대본 틀과 지금까지 쓴 메모를 한 덩어리로 만든다.
 */
function AskAi({
  blocks,
  refVideo,
  onClose,
}: {
  blocks: Block[];
  refVideo: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const find = (label: string) => (blocks.find((b) => b.type === "item" && b.label.includes(label)) as Item | undefined)?.body ?? "";
  const [thumb, setThumb] = useState(find("썸네일"));
  const [title, setTitle] = useState(find("제목"));
  const [tone, setTone] = useState("");
  const [toneOpen, setToneOpen] = useState(true);
  const [busy, start] = useTransition();

  useEffect(() => {
    getTone().then(setTone);
  }, []);

  const build = () => {
    const outline = blocks
      .filter((b) => !(b.type === "item" && /썸네일|제목/.test(b.label)))
      .map((b) => (b.type === "h" ? `\n## ${b.text}` : `- ${b.label} (${b.hint})${b.body ? `\n  메모: ${b.body}` : ""}`))
      .join("\n");
    return [
      "너는 유튜브 대본 작가다. 아래 정보로 영상 대본 초안을 써 줘. 섹션 순서와 항목을 지키고, 각 항목의 메모가 있으면 그 내용을 살려라.",
      "",
      `썸네일 문구: ${thumb || "(미정)"}`,
      `제목: ${title || "(미정)"}`,
      refVideo ? `참고 영상: ${refVideo.title} (https://www.youtube.com/watch?v=${refVideo.id})` : "",
      tone ? `\n내 말투:\n${tone}` : "",
      `\n대본 틀:${outline}`,
      "\n인트로에서는 썸네일·제목이 약속한 것을 바로 확인시켜 주고, 시청자가 공감할 상황으로 붙잡아라.",
    ]
      .filter(Boolean)
      .join("\n");
  };

  return (
    <Modal title="AI에게 부탁하기" onClose={onClose}>
      <p className="text-[12.5px] text-sub">
        썸네일·제목을 정하면, 내 말투와 대본 틀·쓴 메모를 프롬프트로 복사해요. ChatGPT나 Claude에 붙여넣고 대화하면서 대본을 쓰세요.
      </p>
      <label className="mt-4 block text-[12px] text-sub">썸네일</label>
      <input value={thumb} onChange={(e) => setThumb(e.target.value)} placeholder="썸네일에 넣을 문구" className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-[14px] outline-none focus:border-ink" />
      <label className="mt-3 block text-[12px] text-sub">제목</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="영상 제목" className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-[14px] outline-none focus:border-ink" />
      <p className="mt-1 text-[11px] text-faint">여기서 고친 건 이번 복사에만 써요.</p>

      <div className="mt-4 rounded-xl border border-line p-3">
        <button onClick={() => setToneOpen((o) => !o)} className="text-[13px] font-semibold">
          {toneOpen ? "▾" : "▸"} 내 말투 <span className="font-normal text-faint">{tone ? "있음" : "없음"}</span>
        </button>
        {toneOpen && (
          <>
            <textarea
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              rows={5}
              placeholder="예: 해요체가 기본이고 핵심만 합니다체로 끊어요. 「근데」「그니까」를 자주 써요."
              className="mt-2 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-ink"
            />
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => start(async () => (await saveTone(tone), toast("말투를 저장했습니다")))} className="rounded-lg bg-hover/5 px-3 py-1.5 text-[12px]">
                저장
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    try {
                      setTone(await extractTone());
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  })
                }
                className="rounded-lg bg-hover/5 px-3 py-1.5 text-[12px] disabled:opacity-50"
              >
                {busy ? "뽑는 중…" : "내 채널에서 뽑기"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] text-sub">
          닫기
        </button>
        <button
          onClick={() => (navigator.clipboard.writeText(build()), toast("프롬프트를 복사했습니다"), onClose())}
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper"
        >
          프롬프트 복사
        </button>
      </div>
    </Modal>
  );
}
