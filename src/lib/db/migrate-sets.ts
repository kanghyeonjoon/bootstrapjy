/**
 * 세트 도입 1회 이전. 스키마가 만들어진 직후, kv 의 setsMigrated 가 없을 때만 돈다.
 *
 * 세트가 없던 시절의 데이터를 세트로 옮긴다:
 *   - 첫 폴더(위치순) → 세트 하나. 개인 채널은 기존 kv 'myChannel'. 아웃라이어 피드·결 점수도 이 세트로 간다.
 *   - 나머지 폴더 → 폴더마다 세트 하나. 채널이 정확히 1개면 그 채널이 "개인 채널"이었던 것으로 보고
 *     세트의 개인 채널로 올리고 폴더에서는 뺀다 (빈 레퍼런스 폴더가 남는다). 2개 이상이면 폴더 그대로, 개인 채널 없음.
 * 몇 번 돌아도 안전하도록 폴더에 set_id 가 이미 있으면 건드리지 않는다.
 */
type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export async function migrateSets(query: Query): Promise<void> {
  const done = await query("SELECT 1 FROM kv WHERE key = 'setsMigrated'", []);
  if (done.length) return;

  const folders = (await query(
    `SELECT f.id, f.name, (SELECT COUNT(*)::int FROM folder_channels fc WHERE fc.folder_id = f.id) AS n
       FROM folders f WHERE f.set_id IS NULL ORDER BY f.position, f.id`,
    [],
  )) as Array<{ id: number; name: string; n: number }>;

  const mine = (await query("SELECT value #>> '{}' AS v FROM kv WHERE key = 'myChannel'", []))[0]?.v as string | undefined;
  let first = true;
  let color = 0;
  let firstSetId: number | null = null;

  for (const f of folders) {
    let myChannel: string | null = null;
    let setName = f.name;
    let folderName = f.name;

    if (first) {
      first = false;
      myChannel = mine ?? null;
      if (myChannel) {
        const t = (await query("SELECT title FROM channels WHERE channel_id = $1", [myChannel]))[0]?.title as string | undefined;
        if (t) setName = t;
      }
    } else if (f.n === 1) {
      const c = (await query(
        "SELECT c.channel_id, c.title FROM folder_channels fc JOIN channels c USING (channel_id) WHERE fc.folder_id = $1",
        [f.id],
      ))[0] as { channel_id: string; title: string } | undefined;
      if (c) {
        myChannel = c.channel_id;
        setName = f.name;
        folderName = "레퍼런스";
        await query("DELETE FROM folder_channels WHERE folder_id = $1", [f.id]);
      }
    }

    const set = (await query(
      "INSERT INTO sets (name, my_channel_id, color, position) VALUES ($1, $2, $3, $4) RETURNING id",
      [setName, myChannel, color % 6, color],
    ))[0] as { id: number };
    color++;
    firstSetId ??= set.id;
    await query("UPDATE folders SET set_id = $1, name = $2 WHERE id = $3", [set.id, folderName, f.id]);
  }

  if (firstSetId !== null) {
    // 기존 피드·결 점수는 첫 세트(내 레퍼런스) 기준으로 만들어진 것이다
    await query(
      `INSERT INTO set_outlier_feed (set_id, video_id, folder_id, pattern, added_at)
       SELECT f.set_id, o.video_id, o.folder_id, o.pattern, o.added_at
         FROM outlier_feed o JOIN folders f ON f.id = o.folder_id
       ON CONFLICT DO NOTHING`,
      [],
    );
    await query(
      `INSERT INTO set_channel_fit (set_id, channel_id, fit)
       SELECT $1::int, channel_id, fit FROM channels WHERE fit IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [firstSetId],
    );
  }
  await query("INSERT INTO kv (key, value) VALUES ('setsMigrated', 'true') ON CONFLICT DO NOTHING", []);
}
