import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");
const localDataDir = path.join(process.cwd(), ".data", "pglite");

/**
 * localhost:5432 is the SSH tunnel to the work databases, so it is never a valid GymQuest database.
 * Use Supabase (or any hosted Postgres) via DATABASE_URL, or leave it unset for local PGlite.
 */
export function assertSafeDatabaseUrl(url: string): void {
  const { hostname, port } = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  if (local && (port === "" || port === "5432")) {
    throw new Error("DATABASE_URL points at localhost:5432 (the work DB tunnel). Use a hosted Postgres or unset it for PGlite.");
  }
}

const globalForDb = globalThis as unknown as { gymquestDb?: Promise<DB>; gymquestClose?: () => Promise<void> };

/**
 * Makes a hosted connection string safe for postgres.js. It forwards unknown query parameters to the server as
 * startup settings, which Postgres rejects, so provider extras (Supabase's `supa=…`, `pgbouncer=true`) are dropped.
 * Supabase connections get `sslmode=require` if the string doesn't say.
 */
export function normaliseDatabaseUrl(raw: string): string {
  const url = new URL(raw);
  const sslmode = url.searchParams.get("sslmode") ?? (/\.supabase\.(com|co)$/.test(url.hostname) ? "require" : null);
  url.search = sslmode ? `?sslmode=${sslmode}` : "";
  return url.toString();
}

/** DATABASE_URL, or POSTGRES_URL as set by Vercel's Supabase integration. */
export function databaseUrlFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.DATABASE_URL || env.POSTGRES_URL || undefined;
}

async function connectPostgres(raw: string): Promise<DB> {
  assertSafeDatabaseUrl(raw);
  const url = normaliseDatabaseUrl(raw);
  // prepare: false because pooled connection strings (Supabase's transaction pooler on 6543, Neon's pooler) run PgBouncer in
  // transaction mode, which can't keep prepared statements. A small pool suits serverless functions.
  const client = postgres(url, { max: 3, prepare: false });
  const db = drizzlePostgres({ client, schema });
  await migratePostgres(db, { migrationsFolder });
  globalForDb.gymquestClose = () => client.end();
  return db as unknown as DB;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * PGlite has no locking, and two processes opening the same directory corrupt it. A PID lockfile turns that into
 * a clear error. A lock left by a dead process is taken over.
 */
export function acquireLock(dataDir: string): () => void {
  const lockFile = `${dataDir}.lock`;
  if (existsSync(lockFile)) {
    const pid = Number(readFileSync(lockFile, "utf8"));
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(`The local database is open in another process (PID ${pid}). Stop it first, or use npm run demo:reset to reset through the running app.`);
    }
  }
  writeFileSync(lockFile, String(process.pid));
  const release = () => {
    try {
      if (readFileSync(lockFile, "utf8") === String(process.pid)) unlinkSync(lockFile);
    } catch {
      // already gone
    }
  };
  process.once("exit", release);
  return release;
}

/** A PGlite database: file-backed at `.data/pglite` by default, or in memory with `memory: true`. */
export async function connectPglite({ memory = false, dataDir = localDataDir } = {}): Promise<DB> {
  let release = () => {};
  if (!memory) {
    mkdirSync(path.dirname(dataDir), { recursive: true });
    release = acquireLock(dataDir);
  }
  const client = new PGlite(memory ? undefined : dataDir);
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  if (!memory)
    globalForDb.gymquestClose = async () => {
      await client.close();
      release();
    };
  return db as unknown as DB;
}

/**
 * Closes the shared connection. Scripts must call this before exiting: a PGlite data directory left open by a
 * killed process can be corrupted. (PGlite is also single-process: never open `.data/pglite` from two processes.)
 */
export async function closeDb(): Promise<void> {
  await globalForDb.gymquestClose?.();
  globalForDb.gymquestDb = undefined;
  globalForDb.gymquestClose = undefined;
}

/** The app's shared database connection, created once per process. */
export function getDb(): Promise<DB> {
  if (!globalForDb.gymquestDb) {
    const url = databaseUrlFromEnv();
    globalForDb.gymquestDb = url ? connectPostgres(url) : connectPglite();
  }
  return globalForDb.gymquestDb;
}

/** Points getDb() at a given database. Tests use this to inject an in-memory PGlite. */
export function setDb(db: DB): void {
  globalForDb.gymquestDb = Promise.resolve(db);
}
