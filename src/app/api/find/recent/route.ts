import { findRecent } from "@/lib/recent";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 영상 찾기 두 번째 묶음(최근 30일 · 뜨는 중)을 만든다. 결과 화면이 뜬 뒤 따로 부른다 */
export async function POST(req: Request) {
  const { findId } = (await req.json().catch(() => ({}))) as { findId?: number };
  if (!findId) return Response.json({ error: "findId 가 없습니다" }, { status: 400 });
  try {
    return Response.json({ added: await findRecent(findId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
