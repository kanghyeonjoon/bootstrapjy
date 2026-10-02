import { fileURLToPath } from "node:url";
import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 상위 폴더(E:\클로드코드)에도 package-lock 이 있어 루트를 헷갈리지 않게 못 박는다
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // 바탕화면 앱(실행용 빌드)은 .next-app 에 따로 만든다 — 개발 서버(.next)와 섞이지 않게
  distDir: process.env.NEXT_DIST || ".next",
  // PGlite 는 WASM + 파일을 직접 읽으므로 번들하지 않는다
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  images: { unoptimized: true },
};

export default nextConfig;
