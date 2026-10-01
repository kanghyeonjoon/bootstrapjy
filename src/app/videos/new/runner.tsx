"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconCheck } from "@/components/icons";
import { Thumb } from "@/components/VideoCard";
import { ANALYZE_STEPS } from "@/lib/analyze-shared";

/** 분석을 시작하고 단계 체크를 보여 준다. 끝나면 결과 화면으로 넘어간다. */
export function Runner({ videoId, title, thumb }: { videoId: string; title: string; thumb: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ videoId }),
        });
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const e = JSON.parse(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            if (e.type === "step") setStep(e.step);
            else if (e.type === "done") return router.replace(`/videos/${e.analysisId}`);
            else throw new Error(e.message);
          }
        }
        throw new Error("연결이 중간에 끊겼습니다.");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [videoId, router]);

  return (
    <div className="max-w-sm rounded-2xl border border-line bg-card/60 p-4">
      <div className="aspect-video overflow-hidden rounded-xl bg-line/50">
        <Thumb id={videoId} src={thumb} eager />
      </div>
      <p className="mt-2.5 line-clamp-2 text-[13px] font-semibold">{title}</p>
      <ol className="mt-3 space-y-2">
        {ANALYZE_STEPS.map((label, i) => {
          const done = i < step;
          const now = i === step && !error;
          return (
            <li key={label} className="flex items-center gap-2 text-[12.5px]">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ${
                  done ? "bg-ink text-paper" : now ? "border-[1.5px] border-ink" : "border border-line"
                }`}
              >
                {done ? <IconCheck className="h-2.5 w-2.5" /> : now ? <span className="h-1.5 w-1.5 rounded-full bg-ink" /> : null}
              </span>
              <span className={done || now ? "" : "text-faint"}>
                {label}
                {now && <span className="dots ml-1 text-faint" />}
              </span>
            </li>
          );
        })}
      </ol>
      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
