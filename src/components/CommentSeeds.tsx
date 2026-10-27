"use client";

import { useEffect, useState, useTransition } from "react";

import { commentDigest, saveSeed } from "@/app/comments-actions";
import { IconX } from "@/components/icons";
import { toast } from "@/components/Toast";
import { COMMENT_KINDS, type CommentDigest, type CommentKind, type Seed } from "@/lib/comments-shared";
import { compact, since } from "@/lib/format";

/**
 * 댓글 씨앗 창 — 영상 카드의 댓글 버튼으로 연다.
 * 위: 댓글에서 뽑은 주제(아이디어로 저장) / 아래: 걸러 낸 댓글을 갈래별로.
 */
export function CommentSeeds({ videoId, title, onClose }: { videoId: string; title: string; onClose: () => void }) {
  const [d, setD] = useState<CommentDigest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<CommentKind | "all">("all");
  const [savedSeeds, setSavedSeeds] = useState<Set<number>>(new Set());
  const [busy, start] = useTransition();

  const load = (refresh: boolean) =>
    start(async () => {
      setErr(null);
      try {
        setD(await commentDigest(videoId, refresh));
        setSavedSeeds(new Set());
      } catch (e) {
        setErr((e as Error).message);
      }
    });

  useEffect(() => {
    load(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const onSave = (i: number, s: Seed) =>
    start(async () => {
      await saveSeed(videoId, s);
      setSavedSeeds((x) => new Set(x).add(i));
      toast("아이디어에 저장됨", { href: "/ideas", text: "보기" });
    });

  const shown = d?.comments.filter((c) => tab === "all" || c.kind === tab) ?? [];
  const count = (k: CommentKind) => d?.comments.filter((c) => c.kind === k).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="댓글 씨앗"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold">댓글 씨앗</h2>
            <p className="mt-0.5 truncate text-[12px] text-sub">{title}</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="shrink-0">
            <IconX className="h-5 w-5 text-faint" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {!d && !err && (
            <p className="py-10 text-center text-[13px] text-sub">
              댓글을 받아 농담·칭찬을 걸러내는 중… <span className="text-faint">(10~30초)</span>
            </p>
          )}
          {err && <p className="py-6 text-center text-[13px] text-[#C2564F]">{err}</p>}

          {d && (
            <>
              <p className="text-[11.5px] text-faint">
                {d.error
                  ? d.error
                  : `댓글 ${d.fetched}개 중 ${d.comments.length}개 남김 · ${since(d.createdAt)} 받음`}
                <button onClick={() => load(true)} disabled={busy} className="ml-2 underline disabled:opacity-40">
                  {busy ? "다시 받는 중…" : "다시 받기"}
                </button>
              </p>

              {d.seeds.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-[13px] font-bold">댓글에서 나온 주제</h3>
                  <ul className="mt-2 space-y-2">
                    {d.seeds.map((s, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-xl border border-line bg-card px-3.5 py-3">
                        <Kind k={s.kind} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-semibold leading-snug">{s.topic}</p>
                          <p className="mt-0.5 text-[11px] text-faint">근거 댓글 {s.ids.length}개</p>
                        </div>
                        <button
                          disabled={busy || savedSeeds.has(i)}
                          onClick={() => onSave(i, s)}
                          className="shrink-0 rounded-lg bg-hover/5 px-2.5 py-1.5 text-[11.5px] font-medium disabled:opacity-40"
                        >
                          {savedSeeds.has(i) ? "저장됨" : "아이디어로"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {d.comments.length > 0 && (
                <section className="mt-6">
                  <div className="flex flex-wrap gap-1.5">
                    <Tab on={tab === "all"} onClick={() => setTab("all")}>
                      전체 {d.comments.length}
                    </Tab>
                    {(Object.keys(COMMENT_KINDS) as CommentKind[]).map((k) => (
                      <Tab key={k} on={tab === k} onClick={() => setTab(k)}>
                        {COMMENT_KINDS[k].label} {count(k)}
                      </Tab>
                    ))}
                  </div>
                  {tab !== "all" && <p className="mt-2 text-[11px] text-faint">{COMMENT_KINDS[tab].hint}</p>}
                  <ul className="mt-3 space-y-2">
                    {shown.map((c) => (
                      <li key={c.id} className="rounded-xl border border-line bg-card px-3.5 py-3">
                        <div className="flex items-center gap-2 text-[11px] text-faint tabular">
                          <Kind k={c.kind} />
                          좋아요 {compact(c.likes)}
                          {c.replies > 0 && ` · 답글 ${compact(c.replies)}`}
                        </div>
                        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kind({ k }: { k: CommentKind }) {
  const c = COMMENT_KINDS[k];
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
      style={{ backgroundColor: `${c.color}22`, color: c.color }}
    >
      {c.label}
    </span>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] font-medium tabular ${on ? "bg-ink text-paper" : "bg-hover/5 text-sub"}`}
    >
      {children}
    </button>
  );
}
