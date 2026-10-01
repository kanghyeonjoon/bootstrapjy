"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

export function ThemePicker() {
  const [t, setT] = useState<Theme>("system");
  useEffect(() => {
    try {
      setT((localStorage.getItem("theme") as Theme) || "system");
    } catch {}
  }, []);

  const pick = (v: Theme) => {
    setT(v);
    try {
      localStorage.setItem("theme", v);
    } catch {}
    const dark = v === "dark" || (v === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };

  const options: Array<[Theme, string]> = [
    ["light", "라이트"],
    ["dark", "다크"],
    ["system", "시스템"],
  ];
  return (
    <div className="flex rounded-lg bg-hover/[0.06] p-0.5 text-[13px]">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => pick(v)}
          className={`flex-1 rounded-md py-1.5 ${t === v ? "bg-card font-semibold shadow-sm" : "text-sub"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function LogoutButton() {
  return (
    <form action="/api/logout" method="post">
      <button className="rounded-lg border border-line px-4 py-2 text-[13px]">로그아웃</button>
    </form>
  );
}
