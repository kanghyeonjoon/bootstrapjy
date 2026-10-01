import { runAnalysis, type AnalyzeEvent } from "@/lib/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 분석 실행 — 진행 단계를 NDJSON 으로 흘려보낸다 */
export async function POST(req: Request): Promise<Response> {
  const { videoId } = (await req.json().catch(() => ({}))) as { videoId?: string };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (e: AnalyzeEvent) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        if (!videoId || !/^[\w-]{11}$/.test(videoId)) throw new Error("영상 ID 가 올바르지 않습니다.");
        send({ type: "done", analysisId: await runAnalysis(videoId, send) });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        c.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
