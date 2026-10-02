import { hasLLM, llmJson } from "@/lib/ai";
import { isKorean, pool, upsertChannels } from "@/lib/corpus";
import { one, q } from "@/lib/db";
import { PICK } from "@/lib/find";
import { fetchFeed, rssBaseline, saveRssVideos, updateRising } from "@/lib/rss";
import { searchOutliers } from "@/lib/search";
import { channelsByIds, searchVideos } from "@/lib/youtube";

/**
 * 영상 찾기의 두 번째 묶음 — "최근 30일 · 뜨는 중".
 *
 * 검증된 영상(첫 묶음)은 쌓아 둔 DB 에서 꺼내지만, 처음 보는 채널에서 어제 터진 영상은
 * DB 에 있을 수가 없다. 그래서 여기서만 유튜브를 실시간으로 본다:
 *   1. DB 의 30일 안 된 영상 중 뜨는 중(하루 조회수 2배+)이거나 이미 2배+인 것
 *   2. 요청 검색어 2개로 최근 30일 유튜브 검색 (200유닛)
 *      → 처음 보는 채널은 RSS 로 보통 조회수를 그 자리에서 낸다 (할당량 0, 0.3초)
 *   3. 합쳐서 AI 가 "같은 이야기를 하는" 것만 고른다
 * 결과 화면이 뜬 뒤에 따로 불려서, 첫 묶음을 기다리게 하지 않는다.
 */

const DAYS = 30;
const MAX = 10;

export async function findRecent(findId: number): Promise<number> {
  const f = await one<{ prompt: string; intent: string | null; queries: string[]; recent_status: string | null }>(
    "SELECT prompt, intent, queries, recent_status FROM finds WHERE id = $1",
    [findId],
  );
  if (!f) throw new Error("찾기 기록이 없습니다.");
  if (f.recent_status === "done") return 0;
  await q("UPDATE finds SET recent_status = 'running' WHERE id = $1", [findId]);

  try {
    const after = new Date(Date.now() - DAYS * 86_400_000).toISOString();

    // 2. 최근 30일 유튜브 검색 — 한국어 검색어 2개
    const queries = (f.queries ?? []).filter(isKorean).slice(0, 2);
    const found = (
      await Promise.all(
        (queries.length ? queries : [f.prompt]).map((s) =>
          searchVideos(s, { lang: "ko", region: "KR", publishedAfter: after, max: 25 }).catch(() => []),
        ),
      )
    ).flat();

    // 처음 보는 채널: 채널 정보(50개당 1유닛) + RSS 로 보통 조회수 (0유닛)
    const ids = [...new Set(found.map((v) => v.channelId))];
    const known = new Set(
      (await q<{ channel_id: string }>("SELECT channel_id FROM channels WHERE channel_id = ANY($1)", [ids])).map((r) => r.channel_id),
    );
    const fresh = ids.filter((id) => !known.has(id));
    if (fresh.length) {
      await upsertChannels(await channelsByIds(fresh), "discovered");
      await pool(fresh, 10, async (id) => {
        const items = await fetchFeed(id);
        if (!items) return;
        const b = rssBaseline(items);
        await q("UPDATE channels SET avg_long = COALESCE(avg_long, $2), avg_short = COALESCE(avg_short, $3), rss_at = now() WHERE channel_id = $1", [
          id,
          b.long,
          b.short,
        ]);
        await saveRssVideos(items);
      });
    }
    // 검색으로 찾은 영상 자체도 넣는다 (RSS 15편 밖일 수 있다)
    await saveRssVideos(
      found.map((v) => ({
        videoId: v.videoId,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        title: v.title,
        description: v.description,
        publishedAt: v.publishedAt,
        views: v.viewCount,
        thumbnailUrl: v.thumbnailUrl,
        format: v.format,
      })),
    );
    await updateRising(ids);

    // 1+3. DB 의 최근 영상 중 뜨는 중이거나 잘 된 것, 요청과 가까운 순
    const cands = await searchOutliers({
      texts: [f.prompt, f.intent ?? "", ...(f.queries ?? [])],
      minRatio: 0,
      limit: 60,
      where: `v.published_at > now() - interval '${DAYS} days' AND (v.rising >= 2 OR v.ratio >= 2) AND COALESCE(c.fit, 1) > 0
              AND v.video_id NOT IN (SELECT video_id FROM find_hits WHERE find_id = ${Number(findId)} AND section = 'proven')`,
      fast: true,
    });

    let pick = cands.slice(0, MAX).map((c) => c.video_id);
    if (hasLLM() && cands.length) {
      const list = cands.map((c) => `${c.video_id} | ${c.ratio?.toFixed?.(1) ?? "?"}x | ${c.channel_title} | ${c.title_ko ?? c.title}`).join("\n");
      try {
        const out = await llmJson<{ ids: string[] }>(PICK, `하려는 말: ${f.prompt}\n핵심 주장: ${f.intent ?? f.prompt}\n\n${list}`, {
          maxTokens: 800,
          lite: true,
          fast: true,
        });
        const okIds = new Set(cands.map((c) => c.video_id));
        pick = [...new Set(out.ids ?? [])].filter((id) => okIds.has(id)).slice(0, MAX);
      } catch {
        // 가까운 순 그대로
      }
    }

    await q("DELETE FROM find_hits WHERE find_id = $1 AND section = 'recent'", [findId]);
    if (pick.length) {
      await q(
        `INSERT INTO find_hits (find_id, rank, video_id, section)
         SELECT $1, 1000 + r.ord, r.id, 'recent' FROM unnest($2::text[]) WITH ORDINALITY AS r(id, ord)`,
        [findId, pick],
      );
    }
    await q("UPDATE finds SET recent_status = 'done' WHERE id = $1", [findId]);
    return pick.length;
  } catch (e) {
    await q("UPDATE finds SET recent_status = 'error' WHERE id = $1", [findId]);
    throw e;
  }
}
