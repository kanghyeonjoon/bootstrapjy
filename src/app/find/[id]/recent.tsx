"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** 두 번째 묶음(최근 30일 · 뜨는 중)을 결과 화면이 뜬 뒤에 만든다 */
export function RecentLoader({ findId, failed }: { findId: number; failed: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(failed ? "지난번에 실패했어요." : null);
  const started = useRef(false);

  const run = () => {
    setError(null);
    fetch("/api/find/recent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findId }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        router.refresh();
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(() => {
    if (started.current || failed) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl bg-hover/5 px-4 py-8 text-center text-[13px] text-sub">
      {error ? (
        <>
          최근 영상을 불러오지 못했어요 ({error}){" "}
          <button onClick={run} className="font-semibold underline">
            다시 시도
          </button>
        </>
      ) : (
        <>
          최근 30일 영상을 찾는 중<span className="dots ml-1" />
        </>
      )}
    </div>
  );
}
