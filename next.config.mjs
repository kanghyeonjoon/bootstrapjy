/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite 는 WASM + 파일을 직접 읽으므로 번들하지 않는다
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  images: { unoptimized: true },
};

export default nextConfig;
