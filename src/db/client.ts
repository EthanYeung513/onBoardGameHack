import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");
const localDataDir = path.join(process.cwd(), ".data", "pglite");

/**
 * localhost:5432 is the SSH tunnel to the work databases, so it is never a valid GymQuest database.
 * Use Neon (or any remote Postgres) via DATABASE_URL, or leave it unset for local PGlite.
 */
export function assertSafeDatabaseUrl(url: string): void {
  const { hostname, port } = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  if (local && (port === "" || port === "5432")) {
    throw new Error("DATABASE_URL points at localhost:5432 (the work DB tunnel). Use Neon or unset it for PGlite.");
  }
}

async function connectPostgres(url: string): Promise<DB> {
  assertSafeDatabaseUrl(url);
  const db = drizzlePostgres({ client: postgres(url, { max: 5 }), schema });
  await migratePostgres(db, { migrationsFolder });
  return db as unknown as DB;
}

/** A PGlite database: file-backed at `.data/pglite` by default, or in memory with `memory: true`. */
export async function connectPglite({ memory = false } = {}): Promise<DB> {
  if (!memory) mkdirSync(localDataDir, { recursive: true });
  const client = new PGlite(memory ? undefined : localDataDir);
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as DB;
}

const globalForDb = globalThis as unknown as { gymquestDb?: Promise<DB> };

/** The app's shared database connection, created once per process. */
export function getDb(): Promise<DB> {
  if (!globalForDb.gymquestDb) {
    const url = process.env.DATABASE_URL;
    globalForDb.gymquestDb = url ? connectPostgres(url) : connectPglite();
  }
  return globalForDb.gymquestDb;
}

/** Points getDb() at a given database. Tests use this to inject an in-memory PGlite. */
export function setDb(db: DB): void {
  globalForDb.gymquestDb = Promise.resolve(db);
}
