"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconArrowUp, IconCheck, IconSparkle } from "@/components/icons";
import { FIND_STEPS } from "@/lib/find-steps";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; title: string; step: number; details: Record<number, string> }
  | { kind: "error"; title: string; message: string };

/**
 * 영상 찾기 입력창 + 진행 체크리스트.
 * compact = 결과 화면 아래에 떠 있는 "새로 찾기" 입력창.
 */
export function Composer({
  compact = false,
  suggestions = [],
  similar,
  similarTitle,
}: {
  compact?: boolean;
  suggestions?: string[];
  similar?: string;
  similarTitle?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [shorts, setShorts] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = useRef(false);
  const started = useRef(false);

  async function run(body: { prompt?: string; similar?: string }, title: string) {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: "running", title, step: 0, details: {} });
    try {
      const res = await fetch("/api/find", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, includeShorts: shorts }),
      });
      if (!res.body) throw new Error(`서버 응답이 없습니다 (HTTP ${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "step") {
            setPhase((p) =>
              p.kind === "running"
                ? { ...p, step: e.step, details: e.detail ? { ...p.details, [e.step]: e.detail } : p.details }
                : p,
            );
          } else if (e.type === "done") {
            setText("");
            setPhase({ kind: "idle" });
            router.push(`/find/${e.findId}`);
            router.refresh();
            return;
          } else throw new Error(e.message);
        }
      }
      throw new Error("연결이 중간에 끊겼습니다.");
    } catch (e) {
      setPhase({ kind: "error", title, message: (e as Error).message });
    } finally {
      busy.current = false;
    }
  }

  // "비슷한 영상 찾기"로 들어오면 바로 시작한다
  useEffect(() => {
    if (similar && !started.current) {
      started.current = true;
      run({ similar }, `이 영상과 비슷한 영상 · ${similarTitle ?? ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similar]);

  const submit = (t: string) => t.trim().length >= 2 && run({ prompt: t.trim() }, t.trim());

  const progress =
    phase.kind === "idle" ? null : (
      <div className={compact ? "mb-3 rounded-2xl border border-line bg-paper p-5 shadow-lg" : "mx-auto max-w-[640px]"}>
        <p className="text-[15px] font-semibold">{phase.title}</p>
        {phase.kind === "running" ? (
          <ol className="mt-4 space-y-2.5">
            {FIND_STEPS.map((label, i) => {
              const done = i < phase.step;
              const now = i === phase.step;
              return (
                <li key={label} className="flex items-start gap-2.5 text-[13px]">
                  <span
                    className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                      done ? "bg-ink text-paper" : now ? "border-[1.5px] border-ink" : "border border-line"
                    }`}
                  >
                    {done ? <IconCheck className="h-2.5 w-2.5" /> : now ? <span className="h-1.5 w-1.5 rounded-full bg-ink" /> : null}
                  </span>
                  <span>
                    <span className={done || now ? "font-medium" : "text-faint"}>
                      {label}
                      {phase.details[i] && (done || now) && <span className="font-normal text-sub"> · {phase.details[i]}</span>}
                      {now && <span className="dots ml-1 text-faint" />}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-700 dark:text-red-300">
            {phase.message}
          </div>
        )}
      </div>
    );

  const running = phase.kind === "running";
  const box = (
    <form
      onSubmit={(e) => (e.preventDefault(), submit(text))}
      className={`relative rounded-2xl border bg-paper ${compact ? "border-line shadow-[0_6px_24px_rgba(0,0,0,0.08)]" : "border-ink"}`}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit(text);
          }
        }}
        disabled={running}
        maxLength={300}
        rows={compact ? 1 : 4}
        placeholder={compact ? "새로 찾기: 이전 결과와 무관한 새 주제" : "예: 유튜브 초보가 시작하자마자 포기하는 이유"}
        className={`block w-full resize-none bg-transparent px-5 text-[15px] outline-none placeholder:text-faint disabled:opacity-50 ${
          compact ? "py-4 pr-16" : "pb-14 pt-4"
        }`}
      />
      <div className="absolute bottom-3 right-3 flex items-center gap-3">
        {!compact && (
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-sub">
            <input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} className="accent-current" />
            쇼츠 포함
          </label>
        )}
        <button
          type="submit"
          disabled={running || text.trim().length < 2}
          aria-label="검색"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-40"
        >
          <IconArrowUp className="h-4 w-4" />
        </button>
      </div>
    </form>
  );

  if (compact) {
    return (
      <div className="pointer-events-none sticky bottom-0 z-10 bg-gradient-to-t from-paper via-paper/90 to-transparent pb-5 pt-10">
        <div className="pointer-events-auto mx-auto max-w-[640px] px-4">
          {progress}
          {box}
        </div>
      </div>
    );
  }
  if (phase.kind !== "idle") {
    return (
      <>
        {progress}
        {phase.kind === "error" && <div className="mx-auto mt-6 max-w-[640px]">{box}</div>}
      </>
    );
  }
  return (
    <div className="mx-auto max-w-[640px]">
      {box}
      {suggestions.length > 0 && (
        <ul className="mt-6 space-y-0.5">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => submit(s)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-sub hover:bg-hover/5 hover:text-ink"
              >
                <IconSparkle className="h-3.5 w-3.5 shrink-0 text-faint" />
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
