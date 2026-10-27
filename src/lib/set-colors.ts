/** 세트 구분 색 — 점·탭 윗선·카드 윗선에 쓴다. 밝은 배경·어두운 배경 모두에서 읽히는 중간 채도. (클라이언트에서도 쓰므로 DB 를 가져오지 않는 파일에 둔다) */
export const SET_COLORS = ["#2f7de1", "#e0713a", "#2f9e6b", "#a55bd6", "#d6a21e", "#d64b78"] as const;

export const setColor = (n: number) => SET_COLORS[((n % SET_COLORS.length) + SET_COLORS.length) % SET_COLORS.length];
