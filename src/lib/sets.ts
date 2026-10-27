import { q } from "@/lib/db";

/**
 * 세트 = 개인 채널 하나 + 그 채널의 레퍼런스 폴더들. 세트끼리는 분야가 다르니 섞지 않는다.
 * 세트마다 색을 하나 주어 화면에서 한눈에 구분한다.
 */

export interface SetInfo {
  id: number;
  name: string;
  color: number;
  myChannelId: string | null;
  myChannelTitle: string | null;
  folders: number;
}

export async function listSets(): Promise<SetInfo[]> {
  const rows = await q<{
    id: number;
    name: string;
    color: number;
    my_channel_id: string | null;
    my_channel_title: string | null;
    folders: number;
  }>(
    `SELECT s.id, s.name, s.color, s.my_channel_id, c.title AS my_channel_title,
            (SELECT COUNT(*)::int FROM folders f WHERE f.set_id = s.id) AS folders
       FROM sets s LEFT JOIN channels c ON c.channel_id = s.my_channel_id
      ORDER BY s.position, s.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    myChannelId: r.my_channel_id,
    myChannelTitle: r.my_channel_title,
    folders: r.folders,
  }));
}

/** ?set= 값 → 세트. 없거나 잘못되면 첫 세트 */
export function pickSet(sets: SetInfo[], raw: string | undefined): SetInfo | null {
  return sets.find((s) => String(s.id) === raw) ?? sets[0] ?? null;
}

export async function setOfFolder(folderId: number): Promise<number | null> {
  const r = await q<{ set_id: number | null }>("SELECT set_id FROM folders WHERE id = $1", [folderId]);
  return r[0]?.set_id ?? null;
}
