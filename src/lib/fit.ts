import { hasLLM, llmJson } from "@/lib/ai";
import { q } from "@/lib/db";

/**
 * 채널의 "결" — 한 세트(개인 채널 + 레퍼런스 폴더)와 같은 주제·비슷한 내용을 다루는 채널인가.
 *
 * 영상 DB 는 유튜브 검색으로 넓히다 보니 결이 다른 채널(예: 명상 세트인데 연예 뉴스 채널)도 섞인다.
 * 점수는 세트마다 따로 매긴다 — 같은 채널이 명상 세트에서는 0점이고 장사 세트에서는 3점일 수 있다.
 *   3 = 세트의 개인 채널·레퍼런스 채널과 같은 주제   2 = 가까운 주제
 *   1 = 가끔 겹침                                   0 = 결이 다름 (그 세트의 아웃라이어에서 뺀다)
 * 채널 40개(채널명 + 잘 된 영상 제목 5개)당 AI 호출 1번이다.
 * channels.fit 은 "어느 세트에서든 가장 높은 점수"로 같이 갱신해 둔다 (영상 찾기·최신 탭이 그대로 쓴다).
 */

const BATCH = 40;

async function setProfile(setId: number): Promise<string> {
  const me = await q<{ title: string; titles: string[] | null }>(
    `SELECT c.title,
            (SELECT array_agg(t) FROM (SELECT COALESCE(v.title_ko, v.title) AS t FROM videos v
               WHERE v.channel_id = c.channel_id ORDER BY v.ratio DESC NULLS LAST LIMIT 8) x) AS titles
       FROM sets s JOIN channels c ON c.channel_id = s.my_channel_id WHERE s.id = $1`,
    [setId],
  );
  const folders = await q<{ id: number; name: string }>("SELECT id, name FROM folders WHERE set_id = $1 ORDER BY position, id", [setId]);
  const parts: string[] = [];
  if (me[0]) parts.push(`[내 채널: ${me[0].title}]\n잘 된 영상: ${(me[0].titles ?? []).join(" / ") || "(아직 없음)"}`);
  for (const f of folders) {
    const chans = await q<{ title: string }>(
      `SELECT c.title FROM folder_channels fc JOIN channels c ON c.channel_id = fc.channel_id WHERE fc.folder_id = $1 LIMIT 15`,
      [f.id],
    );
    const pats = await q<{ label: string }>("SELECT label FROM patterns WHERE folder_id = $1 ORDER BY position LIMIT 8", [f.id]);
    parts.push(
      `[레퍼런스 폴더: ${f.name}]\n채널: ${chans.map((c) => c.title).join(", ")}\n반복 주제: ${pats.map((p) => p.label).join(" / ") || "(아직 없음)"}`,
    );
  }
  return parts.join("\n\n");
}

/** 세트 하나에서 아직 결을 안 본 채널에 점수를 매긴다. 아웃라이어가 많은 채널부터 */
async function classifyForSet(setId: number, maxChannels: number): Promise<number> {
  // 세트의 레퍼런스 채널은 그 자체가 기준이다
  await q(
    `INSERT INTO set_channel_fit (set_id, channel_id, fit)
     SELECT $1::int, fc.channel_id, 3 FROM folder_channels fc JOIN folders f ON f.id = fc.folder_id WHERE f.set_id = $1
     ON CONFLICT (set_id, channel_id) DO UPDATE SET fit = 3`,
    [setId],
  );
  const profile = await setProfile(setId);
  if (!profile) return 0;

  const chans = await q<{ channel_id: string; title: string; titles: string[] | null }>(
    `SELECT c.channel_id, c.title,
            (SELECT array_agg(t) FROM (SELECT COALESCE(v.title_ko, v.title) AS t FROM videos v
               WHERE v.channel_id = c.channel_id ORDER BY v.ratio DESC NULLS LAST LIMIT 5) x) AS titles
       FROM channels c
      WHERE NOT EXISTS (SELECT 1 FROM set_channel_fit s WHERE s.set_id = $2 AND s.channel_id = c.channel_id)
        AND c.channel_id IS DISTINCT FROM (SELECT my_channel_id FROM sets WHERE id = $2)
      ORDER BY (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.channel_id AND v.ratio >= 2) DESC
      LIMIT $1`,
    [maxChannels, setId],
  );
  let n = 0;
  for (let i = 0; i < chans.length; i += BATCH) {
    const batch = chans.slice(i, i + BATCH);
    const list = batch.map((c) => `${c.channel_id} | ${c.title} | ${(c.titles ?? []).join(" / ")}`).join("\n");
    let out: Record<string, number>;
    try {
      out = await llmJson<Record<string, number>>(
        `너는 유튜브 레퍼런스 큐레이터다. 한 유튜버의 "세트"(내 채널과 그 채널의 레퍼런스 폴더: 채널·반복 주제)와 후보 채널 목록을 받는다.
각 후보 채널이 이 세트와 "같은 주제·비슷한 내용"을 다루는지 0~3점을 매긴다.
3 = 세트의 채널들과 같은 주제·비슷한 내용 / 2 = 가까운 주제 / 1 = 가끔 겹침 / 0 = 결이 다름.
이 세트 하나만 기준으로 한다. 출력은 {"채널ID": 점수} JSON 하나만.`,
        `${profile}\n\n후보 채널 (id | 이름 | 잘 된 영상 제목들):\n${list}`,
        { maxTokens: 2000, lite: true },
      );
    } catch {
      break; // 무료 한도 — 다음에 이어서
    }
    const rows = batch
      .filter((c) => typeof out[c.channel_id] === "number")
      .map((c) => ({ id: c.channel_id, f: Math.max(0, Math.min(3, Math.round(out[c.channel_id]))) }));
    if (rows.length) {
      await q(
        `INSERT INTO set_channel_fit (set_id, channel_id, fit)
         SELECT $2::int, r.id, r.f FROM jsonb_to_recordset($1::jsonb) AS r(id text, f int)
         ON CONFLICT (set_id, channel_id) DO UPDATE SET fit = excluded.fit`,
        [JSON.stringify(rows), setId],
      );
      n += rows.length;
    }
  }
  return n;
}

/**
 * 세트의 결 점수를 채우고, channels.fit(세트 중 최고 점수)을 맞춘다.
 * onlySetId 를 주면 그 세트에 한도를 전부 쓴다 (사용자가 "지금 고르기"를 누른 세트를 빨리 걸러내려고).
 */
export async function classifyChannelFit(maxChannels = 400, onlySetId?: number): Promise<number> {
  if (!hasLLM()) return 0;
  const sets = (await q<{ id: number }>("SELECT id FROM sets ORDER BY position, id")).filter((s) => !onlySetId || s.id === onlySetId);
  if (!sets.length) return 0;
  let n = 0;
  const each = Math.max(40, Math.ceil(maxChannels / sets.length));
  for (const s of sets) n += await classifyForSet(s.id, each);
  await q(
    `UPDATE channels c SET fit = m.f FROM (SELECT channel_id, MAX(fit) AS f FROM set_channel_fit GROUP BY channel_id) m
      WHERE c.channel_id = m.channel_id AND c.fit IS DISTINCT FROM m.f`,
  );
  return n;
}

/** 세트의 폴더·개인 채널이 바뀌면 그 세트의 결 점수를 다시 매겨야 한다 (레퍼런스 채널 자체는 3점 유지) */
export async function resetSetFit(setId: number): Promise<void> {
  await q(
    `DELETE FROM set_channel_fit WHERE set_id = $1 AND channel_id NOT IN
       (SELECT fc.channel_id FROM folder_channels fc JOIN folders f ON f.id = fc.folder_id WHERE f.set_id = $1)`,
    [setId],
  );
}
