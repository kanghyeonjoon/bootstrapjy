"use client";

import { useState, useTransition } from "react";

import { IconCopy } from "@/components/icons";
import { toast } from "@/components/Toast";
import { HOOK_TAGS } from "@/lib/analyze-shared";
import { saveIdeas } from "./actions";

export function Hook({ lines, tags }: { lines: Array<{ text: string; tag: string | null }>; tags: string[] }) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold">초반 훅 정리</h2>
        <button
          onClick={() => (navigator.clipboard.writeText(lines.map((l) => l.text).join("\n")), toast("훅을 복사했습니다"))}
          className="flex items-center gap-1.5 rounded-lg bg-hover/5 px-3 py-1.5 text-[12px] font-medium"
        >
          <IconCopy className="h-3.5 w-3.5" /> 전체 복사
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="rounded-md border-b-2 px-2 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: `${HOOK_TAGS[t]}22`, borderColor: HOOK_TAGS[t] }}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 rounded-xl border border-line bg-card px-4 py-3.5 text-[14px] leading-relaxed">
        {lines.map((l, i) => (
          <p key={i}>
            <span
              className={l.tag ? "rounded-sm border-b-2 px-0.5" : ""}
              style={l.tag ? { backgroundColor: `${HOOK_TAGS[l.tag]}26`, borderColor: HOOK_TAGS[l.tag] } : undefined}
              title={l.tag ?? undefined}
            >
              {l.text}
            </span>
          </p>
        ))}
      </div>
    </section>
  );
}

export function Claims({ videoId, claims }: { videoId: string; claims: Array<{ claim: string; evidence: string }> }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, start] = useTransition();

  const save = (idx: number[]) =>
    start(async () => {
      const n = await saveIdeas(videoId, idx.map((i) => claims[i]));
      setSel(new Set());
      toast(`아이디어 ${n}개 저장됨`, { href: "/ideas", text: "보기" });
    });

  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-bold">핵심 요약</h2>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-sub">저장할 아이디어를 선택하세요.</p>
        <div className="flex gap-1.5">
          <button
            disabled={!sel.size || busy}
            onClick={() => save([...sel].sort((a, b) => a - b))}
            className="rounded-lg bg-hover/5 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            {sel.size ? `선택한 ${sel.size}개 저장` : "선택한 아이디어 저장"}
          </button>
          <button
            disabled={busy}
            onClick={() => save(claims.map((_, i) => i))}
            className="rounded-lg bg-hover/5 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            전체 {claims.length}개 저장
          </button>
        </div>
      </div>
      <ul className="mt-3 space-y-2.5">
        {claims.map((c, i) => {
          const on = sel.has(i);
          return (
            <li key={i} className={`rounded-xl border bg-card px-4 py-3.5 ${on ? "border-ink" : "border-line"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10.5px] text-faint">핵심 주장</p>
                  <p className="mt-0.5 text-[14px] font-bold leading-snug">{c.claim}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11.5px] text-sub">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        if (on) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                    className="accent-current"
                  />
                  선택
                </label>
              </div>
              <p className="mt-2.5 text-[10.5px] text-faint">근거</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-sub">{c.evidence}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
