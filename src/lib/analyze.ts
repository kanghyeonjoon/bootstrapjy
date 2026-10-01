import { claudeJson, geminiOnVideo, hasClaude, hasGemini, parseJson } from "@/lib/ai";
import { ingestVideos } from "@/lib/corpus";
import { one, q } from "@/lib/db";
import { videosByIds } from "@/lib/youtube";

/**
 * 분석하기 — Vidoutliers 결과 화면을 그대로 만든다.
 *
 *   분석 요청 확인 → 자막 불러오기 → 훅·핵심 내용 정리
 *
 * - 초반 훅: 인트로 대사 원문을 줄 단위로, 줄마다 쓰인 기법 태그(궁금증 남기기 등)
 * - 핵심 요약: "핵심 주장" 한 문장 + "근거" 2~3문장, 15개 안팎
 *
 * 자막은 Gemini 가 유튜브 영상을 직접 보고 받아 적는다. 클라우드 서버에서 자막 파일을
 * 긁으면 막히는 일이 잦아서다.
 */

export { ANALYZE_STEPS, HOOK_TAGS } from "@/lib/analyze-shared";
import { HOOK_TAGS } from "@/lib/analyze-shared";

const TRANSCRIBE = `이 유튜브 영상을 보고 JSON 하나만 출력하라.
{
  "intro": ["영상 시작부터 약 40초까지 화자가 실제로 말한 문장을 원문 그대로, 한 문장씩"],
  "notes": "영상 전체 내용을 빠짐없이 정리한 상세 노트 (주장·근거·사례·숫자 포함, 한국어, 2500~4000자)"
}
- intro 는 요약하지 말고 들리는 그대로 받아 적는다. 외국어 영상이면 자연스러운 한국어로 옮긴다.
- 인트로 앞의 배경음악·효과음 구간은 건너뛴다.`;

const SUMMARIZE = `너는 유튜브 기획 분석가다. 영상의 인트로 대사와 전체 노트를 받는다.

1) hook: 인트로 대사 각 줄에 쓰인 훅 기법을 하나씩 붙인다. 기법은 다음 중에서만:
   궁금증 남기기 / 시청자 공감 / 증거·권위 / 반전·충격 / 이득 약속 / 문제 제기
   평범한 연결 문장은 tag 를 null 로 둔다. 문장은 고치지 말고 그대로 쓴다.
2) claims: 영상의 핵심 주장 12~16개. 영상 흐름 순서대로.
   - claim: 화자의 주장 한 문장 (단정형, 40자 안팎)
   - evidence: 화자가 그 주장을 뒷받침한 근거·사례·비유 2~3문장 ("화자는 ~라고 설명한다" 같은 서술체)

출력은 JSON 하나만: {"hook":[{"text":"...","tag":"궁금증 남기기"|null}],"claims":[{"claim":"...","evidence":"..."}]}`;

export type AnalyzeEvent =
  | { type: "step"; step: number }
  | { type: "done"; analysisId: number }
  | { type: "error"; message: string };

export async function runAnalysis(videoId: string, emit: (e: AnalyzeEvent) => void): Promise<number> {
  emit({ type: "step", step: 0 });
  if (!hasGemini()) throw new Error("분석에는 GEMINI_API_KEY 가 필요합니다 (영상을 직접 읽는 데 씁니다).");

  // 코퍼스에 없는 영상(유튜브 링크로 바로 들어온 경우)은 먼저 넣는다
  if (!(await one("SELECT 1 FROM videos WHERE video_id = $1", [videoId]))) {
    const v = await videosByIds([videoId]);
    if (!v.length) throw new Error("영상을 찾을 수 없습니다.");
    await ingestVideos(v, { maxNewChannels: 1 });
  }
  const [{ id }] = await q<{ id: number }>(
    "INSERT INTO analyses (video_id, status) VALUES ($1, 'transcript') RETURNING id",
    [videoId],
  );

  try {
    emit({ type: "step", step: 1 });
    const raw = parseJson<{ intro: string[]; notes: string }>(await geminiOnVideo(videoId, TRANSCRIBE));
    await q("UPDATE analyses SET status = 'summarizing', updated_at = now() WHERE id = $1", [id]);

    emit({ type: "step", step: 2 });
    const input = `인트로 대사:\n${raw.intro.join("\n")}\n\n전체 노트:\n${raw.notes}`;
    const out = hasClaude()
      ? await claudeJson<{ hook: Array<{ text: string; tag: string | null }>; claims: Array<{ claim: string; evidence: string }> }>(
          SUMMARIZE,
          input,
          6000,
        )
      : parseJson<{ hook: Array<{ text: string; tag: string | null }>; claims: Array<{ claim: string; evidence: string }> }>(
          await geminiOnVideo(videoId, `${SUMMARIZE}\n\n${input}`),
        );

    const hook = out.hook.map((h) => ({ text: h.text, tag: h.tag && HOOK_TAGS[h.tag] ? h.tag : null }));
    const tags = [...new Set(hook.map((h) => h.tag).filter(Boolean))];
    await q(
      `UPDATE analyses SET status = 'done', hook_lines = $2, hook_tags = $3, claims = $4, updated_at = now()
        WHERE id = $1`,
      [id, JSON.stringify(hook), JSON.stringify(tags), JSON.stringify(out.claims)],
    );
    return id;
  } catch (e) {
    await q("UPDATE analyses SET status = 'error', error = $2 WHERE id = $1", [id, (e as Error).message]);
    throw e;
  }
}
