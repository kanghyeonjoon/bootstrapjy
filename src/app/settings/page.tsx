import { hasClaude, hasGemini } from "@/lib/ai";
import { corpusSize } from "@/lib/corpus";
import { one } from "@/lib/db";
import { LogoutButton, ThemePicker } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "설정" };

export default async function Settings() {
  const ch = await one<{ n: string; f: string }>(
    "SELECT COUNT(*)::text AS n, COUNT(*) FILTER (WHERE source = 'folder')::text AS f FROM channels",
  );
  const rows: Array<[string, React.ReactNode]> = [
    ["Claude (분석·검색어·패턴)", <Status key="c" ok={hasClaude()} />],
    ["Gemini (뜻 검색·자막)", <Status key="g" ok={hasGemini()} />],
    ["유튜브", <Status key="y" ok={Boolean(process.env.YOUTUBE_API_KEY || process.env.YT_REFRESH_TOKEN)} />],
    [
      "영상 DB",
      `${(await corpusSize()).toLocaleString()}편 · 채널 ${Number(ch?.n ?? 0).toLocaleString()}개 (폴더 ${ch?.f ?? 0})`,
    ],
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-8">
      <h1 className="mb-6 text-[24px] font-bold tracking-tight">설정</h1>

      <Section label="CONNECTIONS" title="연결 상태">
        <dl className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-2.5 text-[13.5px]">
              <dt className="text-sub">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        label="APPEARANCE"
        title="화면 테마"
        desc="이 브라우저에서 앱 화면에 적용할 테마입니다. 시스템은 기기 설정을 따릅니다."
      >
        <ThemePicker />
      </Section>

      {process.env.APP_PASSWORD && (
        <Section label="SESSION" title="로그아웃" desc="현재 브라우저의 로그인을 끝냅니다.">
          <LogoutButton />
        </Section>
      )}
    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return <span className={ok ? "font-medium text-[#4E7A3A]" : "text-faint"}>{ok ? "연결됨" : "키 없음"}</span>;
}

function Section({
  label,
  title,
  desc,
  children,
}: {
  label: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-card/60 p-5">
      <p className="text-[10.5px] font-semibold tracking-widest text-faint">{label}</p>
      <h2 className="mt-1 text-[15px] font-bold">{title}</h2>
      {desc && <p className="mt-1 text-[12.5px] text-sub">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
