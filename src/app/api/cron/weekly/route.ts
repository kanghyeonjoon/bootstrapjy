import { runOutlierBatch } from "@/lib/outliers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 주간 아웃라이어 배치 (Vercel Cron, 월요일 새벽) */
export async function GET() {
  return Response.json(await runOutlierBatch(240_000));
}
