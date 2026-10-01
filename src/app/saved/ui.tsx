"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moveSaved, setSaveReason, toggleSave } from "@/app/actions";
import { toast } from "@/components/Toast";
import { VideoCard } from "@/components/VideoCard";
import type { VideoCardData } from "@/lib/videos";
import { createTopic, deleteTopic, renameTopic } from "./actions";

export function SavedCard({
  v,
  reason,
  topics,
  current,
}: {
  v: VideoCardData;
  reason: string;
  topics: Array<{ id: number; name: string }>;
  current: number;
}) {
  const [, start] = useTransition();
  const [moving, setMoving] = useState(false);
  const others = topics.filter((t) => t.id !== current);

  return (
    <VideoCard
      v={v}
      menu={["script"]}
      hideSave
      extraMenu={[
        ...(others.length ? [{ label: "주제 이동", run: () => setMoving(true) }] : []),
        { label: "저장 취소", run: () => start(async () => (await toggleSave(v.videoId), toast("저장 취소됨"))) },
      ]}
      footer={
        <>
          {moving && (
            <div className="mt-2 flex flex-wrap gap-1">
              {others.map((t) => (
                <button
                  key={t.id}
                  onClick={() => start(async () => (await moveSaved(v.videoId, t.id), toast(`'${t.name}'(으)로 옮겼습니다`)))}
                  className="rounded-full border border-line px-2.5 py-1 text-[11.5px] hover:border-ink"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <Reason videoId={v.videoId} initial={reason} />
        </>
      }
    />
  );
}

/** "+ 저장 이유" — 왜 이 영상이 떴는지 내 생각을 적어 둔다. 포커스가 빠지면 저장 */
function Reason({ videoId, initial }: { videoId: string; initial: string }) {
  const [val, setVal] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();

  if (!editing && !val) {
    return (
      <button onClick={() => setEditing(true)} className="mt-2 w-full rounded-lg border border-dashed border-line py-1.5 text-left text-[12px] text-faint hover:text-ink">
        <span className="px-2.5">+ 저장 이유</span>
      </button>
    );
  }
  return (
    <textarea
      autoFocus={editing}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        if (val !== initial) start(() => setSaveReason(videoId, val));
      }}
      rows={2}
      placeholder="왜 저장했나요?"
      className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] outline-none focus:border-ink"
    />
  );
}

export function NewTopic() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [, start] = useTransition();
  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="px-3 py-2 text-[13px] text-faint hover:text-ink">
        + 새 주제
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const id = await createTopic(name);
          setAdding(false);
          setName("");
          router.push(`/saved?topic=${id}`);
        });
      }}
      className="mb-1 flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name && setAdding(false)}
        placeholder="주제 이름"
        className="w-28 bg-transparent text-[13px] outline-none"
      />
      <button className="text-[12px] font-semibold">만들기</button>
    </form>
  );
}

export function TopicHeader({ id, name, count, deletable }: { id: number; name: string; count: number; deletable: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <div className="flex items-center justify-between border-b border-line pb-3 text-[13px]">
      <p>
        <b>{name}</b> <span className="text-faint">· 영상 {count}개</span>
      </p>
      <div className="flex gap-2 text-[12px]">
        <button
          onClick={() => {
            const n = prompt("주제 이름", name);
            if (n) start(() => renameTopic(id, n));
          }}
          className="text-sub hover:text-ink"
        >
          이름 바꾸기
        </button>
        {deletable && (
          <button
            onClick={() => {
              if (!confirm(`'${name}' 주제를 지울까요? 안의 영상은 첫 주제로 옮겨집니다.`)) return;
              start(async () => (await deleteTopic(id), router.push("/saved")));
            }}
            className="text-faint hover:text-red-600"
          >
            주제 삭제
          </button>
        )}
      </div>
    </div>
  );
}
