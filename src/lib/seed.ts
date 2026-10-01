import { hasLLM, llmJson } from "@/lib/ai";
import { embedPending, ingestVideos, isKorean, translatePending } from "@/lib/corpus";
import { getKv, q, setKv } from "@/lib/db";
import { quotaToday, searchVideos } from "@/lib/youtube";

/**
 * DB 를 미리 키우는 밤 작업 — Vidoutliers 의 "영상 75,492개"에 해당하는 것.
 *
 * 영상 찾기가 빠르려면 찾을 때 유튜브를 뒤지면 안 되고, 이미 DB 에 있어야 한다.
 * 그래서 내가 관심 있을 만한 주제로 매일 밤 새 채널을 들인다:
 *   - 폴더 패턴 (내 레퍼런스의 반복 주제)
 *   - 최근에 찾아 본 문장
 *   - 저장한 영상 제목
 * 같은 주제는 7일에 한 번만 훑는다. 유튜브 할당량은 하루 6,000 을 넘기지 않는다.
 */

const DAILY_QUOTA_CAP = 6_000;
const TOPICS_PER_RUN = 10;
const NEW_CHANNELS_PER_TOPIC = 12;
const RESEED_DAYS = 7;

export async function seedCorpus(budgetMs: number): Promise<{ topics: number }> {
  const start = Date.now();
  const seeded = await getKv<Record<string, string>>("seededTopics", {});
  const fresh = (t: string) => !seeded[t] || Date.now() - new Date(seeded[t]).getTime() > RESEED_DAYS * 86_400_000;

  const finds = await q<{ prompt: string; queries: string[] }>(
    "SELECT prompt, queries FROM finds WHERE status = 'done' AND created_at > now() - interval '30 days' ORDER BY id DESC LIMIT 20",
  );
  const patterns = await q<{ label: string }>("SELECT label FROM patterns ORDER BY created_at DESC LIMIT 20");
  const saved = await q<{ title: string }>(
    `SELECT COALESCE(v.title_ko, v.title) AS title FROM saved_videos s JOIN videos v ON v.video_id = s.video_id
      ORDER BY s.saved_at DESC LIMIT 10`,
  );

  // 이미 검색어가 있는 최근 찾기 → 패턴 → 저장 영상 순
  const topics: Array<{ key: string; queries?: string[] }> = [
    ...finds.map((f) => ({ key: f.prompt, queries: f.queries })),
    ...patterns.map((p) => ({ key: p.label })),
    ...saved.map((s) => ({ key: s.title })),
  ].filter((t, i, all) => fresh(t.key) && all.findIndex((x) => x.key === t.key) === i);

  let done = 0;
  for (const t of topics.slice(0, TOPICS_PER_RUN)) {
    if (Date.now() - start > budgetMs || (await quotaToday()) > DAILY_QUOTA_CAP) break;
    let qs = t.queries?.length ? t.queries.slice(0, 3) : [t.key];
    if (!t.queries?.length && hasLLM()) {
      qs = (
        await llmJson<{ q: string[] }>(
          '영상 주제 하나를 받아 같은 주제의 인기 유튜브 영상을 찾을 검색어 2개를 만든다. 한국어 하나, 영어 하나. {"q":["...","..."]} JSON 하나만.',
          t.key,
          { maxTokens: 200, lite: true },
        ).catch(() => ({ q: [t.key] }))
      ).q;
    }
    const found = (
      await Promise.all(
        qs.map((s) => searchVideos(s, isKorean(s) ? { lang: "ko", region: "KR" } : { lang: "en" }).catch(() => [])),
      )
    ).flat();
    await ingestVideos(found, { maxNewChannels: NEW_CHANNELS_PER_TOPIC });
    seeded[t.key] = new Date().toISOString();
    done++;
  }
  await setKv("seededTopics", seeded);

  if (Date.now() - start < budgetMs) await translatePending(200).catch(() => 0);
  const left = budgetMs - (Date.now() - start);
  if (left > 5_000) await embedPending(450, left).catch(() => 0);
  return { topics: done };
}
