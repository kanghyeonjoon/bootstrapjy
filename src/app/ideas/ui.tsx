"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Modal } from "@/app/dashboard/ui";
import { IconChevron, IconExternal } from "@/components/icons";
import { toast } from "@/components/Toast";
import { ymd } from "@/lib/format";
import {
  addIdea,
  classifyIdeas,
  createChapter,
  deleteChapter,
  deleteIdea,
  moveIdea,
  renameChapter,
} from "./actions";
import type { IdeaRow } from "./page";

export function NewChapter() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [, start] = useTransition();
  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="px-3 py-2 text-[13px] text-faint hover:text-ink">
        + 새 챕터
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const id = await createChapter(name);
          setAdding(false);
          setName("");
          router.push(`/ideas?chapter=${id}`);
        });
      }}
      className="mb-1 flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name && setAdding(false)}
        placeholder="챕터 이름"
        className="w-28 bg-transparent text-[13px] outline-none"
      />
      <button className="text-[12px] font-semibold">만들기</button>
    </form>
  );
}

export function ChapterHeader({ id, name, children }: { id: number | null; name: string; children: React.ReactNode }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
      <p className="text-[13px] font-semibold">{name}</p>
      <div className="flex items-center gap-1.5 text-[12px]">
        {id && (
          <>
            <button
              onClick={() => {
                const n = prompt("챕터 이름", name);
                if (n) start(() => renameChapter(id, n));
              }}
              className="px-2 py-1.5 text-sub hover:text-ink"
            >
              이름 바꾸기
            </button>
            <button
              onClick={() => {
                if (!confirm(`'${name}' 챕터를 지울까요? 안의 아이디어는 미분류로 돌아갑니다.`)) return;
                start(async () => (await deleteChapter(id), router.push("/ideas")));
              }}
              className="px-2 py-1.5 text-faint hover:text-red-600"
            >
              챕터 삭제
            </button>
          </>
        )}
        {children}
      </div>
    </div>
  );
}

export function ClassifyButton({ disabled }: { disabled: boolean }) {
  const [busy, start] = useTransition();
  return (
    <button
      disabled={disabled || busy}
      title={disabled ? "챕터를 먼저 만들면 미분류 아이디어를 AI 가 나눠 넣습니다" : undefined}
      onClick={() =>
        start(async () => {
          try {
            toast(`${await classifyIdeas()}개를 챕터로 옮겼습니다`);
          } catch (e) {
            toast((e as Error).message);
          }
        })
      }
      className="rounded-lg bg-hover/5 px-3 py-1.5 font-medium disabled:opacity-40"
    >
      {busy ? "분류하는 중…" : "AI 분류"}
    </button>
  );
}

export function AddIdeaButton({ chapterId }: { chapterId: number | null }) {
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, start] = useTransition();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-paper">
        + 아이디어 추가
      </button>
      {open && (
        <Modal title="아이디어 추가" onClose={() => setOpen(false)}>
          <label className="text-[12px] text-sub">아이디어</label>
          <textarea
            autoFocus
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-[14px] outline-none focus:border-ink"
          />
          <label className="mt-3 block text-[12px] text-sub">메모 (선택)</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-[14px] outline-none focus:border-ink"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-[13px] text-sub">
              취소
            </button>
            <button
              disabled={!idea.trim() || busy}
              onClick={() =>
                start(async () => {
                  await addIdea(chapterId, idea, memo);
                  setIdea("");
                  setMemo("");
                  setOpen(false);
                })
              }
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-40"
            >
              저장
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function IdeaGroup({
  title,
  videoId,
  items,
  chapters,
}: {
  title: string;
  videoId: string | null;
  items: IdeaRow[];
  chapters: Array<{ id: number; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  return (
    <div className="rounded-xl border border-line bg-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold">{title}</span>
          <span className="text-[11px] text-faint">
            아이디어 {items.length}개 · {ymd(items[0].created_at)}
          </span>
        </span>
        <IconChevron className={`h-4 w-4 shrink-0 text-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-line px-4 pb-3">
          {videoId && (
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] text-sub hover:text-ink"
            >
              원본 영상 보기 <IconExternal className="h-3 w-3" />
            </a>
          )}
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="py-3">
                <p className="text-[13.5px] font-semibold leading-snug">{i.claim}</p>
                {(i.evidence || i.memo) && (
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-sub">{i.evidence ?? i.memo}</p>
                )}
                <div className="mt-2 flex items-center gap-3 text-[11px] text-faint">
                  <span>{ymd(i.created_at)}</span>
                  {chapters.length > 0 && (
                    <select
                      defaultValue=""
                      onChange={(e) => start(() => moveIdea(i.id, e.target.value === "none" ? null : Number(e.target.value)))}
                      className="bg-transparent outline-none hover:text-ink"
                    >
                      <option value="" disabled>
                        챕터 이동
                      </option>
                      <option value="none">미분류</option>
                      {chapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => start(() => deleteIdea(i.id))} className="hover:text-red-600">
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
