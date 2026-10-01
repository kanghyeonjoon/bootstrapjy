/** 분석 화면과 서버가 같이 쓰는 상수 (클라이언트에서도 불러온다) */

export const ANALYZE_STEPS = ["분석 요청 확인", "자막 불러오기", "훅·핵심 내용 정리"] as const;

/** 훅 기법 태그와 색 — 앞의 셋은 Vidoutliers 실측 */
export const HOOK_TAGS: Record<string, string> = {
  "궁금증 남기기": "#A78BDA",
  "시청자 공감": "#7FBF7F",
  "증거·권위": "#6FA8DC",
  "반전·충격": "#E59866",
  "이득 약속": "#E6C25A",
  "문제 제기": "#E57373",
};

