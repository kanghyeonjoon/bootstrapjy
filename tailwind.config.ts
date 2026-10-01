import type { Config } from "tailwindcss";

// 색은 전부 CSS 변수로 둔다 — 라이트/다크 테마를 변수만 바꿔 전환한다 (globals.css)
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        side: v("side"),
        card: v("card"),
        line: v("line"),
        ink: v("ink"),
        sub: v("sub"),
        faint: v("faint"),
        hover: v("hover"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Pretendard Variable", "Pretendard", "Malgun Gothic", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
