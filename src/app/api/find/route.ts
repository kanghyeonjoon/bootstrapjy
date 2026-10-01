import { after } from "next/server";

import { expandForQueries, runFind, type FindEvent } from "@/lib/find";

export const dynamic = "force-dynamic";
// 응답 뒤 DB 확장(after)까지 이 시간 안에서 돈다
export const maxDuration = 300;

/**
 * 영상 찾기 실행. 진행 단계를 한 줄짜리 JSON(NDJSON)으로 흘려보낸다.
 * 결과를 보낸 **뒤에** 같은 검색어로 DB 를 넓힌다 — 사용자는 그걸 기다리지 않는다.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; similar?: string; includeShorts?: boolean };
  // after() 는 요청 안에서 바로 등록해야 한다. 검색어는 찾기가 끝나야 알 수 있으니 약속으로 넘긴다
  let handOff: (qs: string[]) => void = () => {};
  const queries = new Promise<string[]>((r) => (handOff = r));
  after(async () => {
    const qs = await queries;
    if (qs.length) await expandForQueries(qs).catch((e) => console.error("[find] DB 확장 실패", e));
  });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (e: FindEvent) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        const r = await runFind(
          { prompt: body.prompt, similar: body.similar, includeShorts: body.includeShorts === true },
          send,
        );
        send({ type: "done", findId: r.findId });
        handOff(r.queries);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
        handOff([]);
      } finally {
        c.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
