import fs from "node:fs";
import path from "node:path";

import { migrateSets } from "./migrate-sets";
import { SCHEMA_SQL } from "./schema";

/**
 * DB 접근 한 곳.
 *
 * - 배포(Vercel): DATABASE_URL 이 있으면 Neon Postgres 에 HTTP 로 붙는다.
 * - 로컬: 없으면 PGlite(WASM Postgres)를 data/pglite 폴더에 띄운다.
 *
 * 둘 다 진짜 Postgres 라 SQL·pgvector 가 똑같이 돈다. 화면 코드는 q()만 쓴다.
 */

export type Row = Record<string, unknown>;

interface Driver {
  query(text: string, params: unknown[]): Promise<Row[]>;
}


declare global {
  // dev 서버 HMR 때 PGlite 를 두 번 열면 파일 잠금이 깨진다
  var __refDb: Promise<Driver> | undefined;
}

async function open(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  let driver: Driver;

  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    driver = { query: async (text, params) => (await sql.query(text, params)) as Row[] };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await import("@electric-sql/pglite-pgvector");
    // PGLITE_DIR: 실제 데이터를 건드리지 않고 사본으로 시험할 때 쓴다
    const dir = process.env.PGLITE_DIR || path.join(process.cwd(), "data", "pglite");
    fs.mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir, { extensions: { vector } });
    driver = { query: async (text, params) => (await pg.query<Row>(text, params)).rows };
  }

  // 스키마는 전부 IF NOT EXISTS 라 몇 번 돌려도 안전하지만, 클라우드는 요청마다 새로 뜨므로
  // 스키마 파일이 바뀌었을 때만 돌린다 (지문을 kv 에 남겨 둔다).
  const text = SCHEMA_SQL;
  const hash = fingerprint(text);
  const done = await driver
    .query("SELECT value FROM kv WHERE key = 'schemaHash'", [])
    .then((r) => r[0]?.value === hash)
    .catch(() => false);
  if (!done) {
    // 문장 단위로 나눠 보낸다 (Neon HTTP 는 한 요청에 한 문장만 받는다)
    const statements = text
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const s of statements) await driver.query(s, []);
    await driver.query(
      `INSERT INTO kv (key, value) VALUES ('schemaHash', $1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(hash)],
    );
  }
  await migrateSets((text, params) => driver.query(text, params));
  return driver;
}

function fingerprint(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${text.length}-${h >>> 0}`;
}

function db(): Promise<Driver> {
  globalThis.__refDb ??= open().catch((e) => {
    globalThis.__refDb = undefined;
    throw e;
  });
  return globalThis.__refDb;
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await (await db()).query(text, params)) as T[];
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

/** pgvector 리터럴. 파라미터로 넘길 때 '[0.1,0.2,…]' 문자열로 보낸다. */
export function vec(v: number[]): string {
  return `[${v.join(",")}]`;
}

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>("SELECT value FROM kv WHERE key = $1", [key]);
  return row ? row.value : fallback;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await q(
    `INSERT INTO kv (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}
