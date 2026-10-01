/** 화면 표시용 포맷. 숫자 읽는 규칙을 한 곳에 둔다. */

/** 1.2만 / 3.5천 / 1.1억 — Vidoutliers 와 같은 한국식 축약 */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  if (n >= 100_000_000) return `${trim(n / 100_000_000)}억`;
  if (n >= 10_000) return `${trim(n / 10_000)}만`;
  if (n >= 1_000) return `${trim(n / 1_000)}천`;
  return n.toLocaleString();
}
const trim = (x: number) => (x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(1).replace(/\.0$/, ""));

export function since(iso: string | Date): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) {
    const h = Math.floor(ms / 3_600_000);
    return h < 1 ? "방금" : `${h}시간 전`;
  }
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30)}달 전`;
  return `${Math.floor(d / 365)}년 전`;
}

export function ymd(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function duration(sec: number): string {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** 배수 배지 색 — Vidoutliers 실측값 */
export function ratioColor(r: number): string {
  if (r >= 10) return "#A23E2D";
  if (r >= 5) return "#E07B3F";
  if (r >= 3) return "#C99323";
  if (r >= 2) return "#7FA968";
  return "#9A9282";
}

export const ratioText = (r: number) => `${r >= 100 ? Math.round(r) : r.toFixed(1)}x`;
