import { runFind, type FindEvent } from "@/lib/find";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 영상 찾기 실행. 진행 단계를 한 줄짜리 JSON(NDJSON)으로 흘려보낸다. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; similar?: string; includeShorts?: boolean };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (e: FindEvent) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        const findId = await runFind(
          { prompt: body.prompt, similar: body.similar, includeShorts: body.includeShorts === true },
          send,
        );
        send({ type: "done", findId });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        c.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
