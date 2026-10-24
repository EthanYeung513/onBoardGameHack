import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, assertSafeDatabaseUrl, connectPglite, databaseUrlFromEnv, normaliseDatabaseUrl } from "@/db/client";
import { companies } from "@/db/schema";

describe("db client", () => {
  it("refuses the work DB tunnel on localhost:5432", () => {
    expect(() => assertSafeDatabaseUrl("postgres://u:p@localhost:5432/apricot_dev_db")).toThrow(/work DB tunnel/);
    expect(() => assertSafeDatabaseUrl("postgres://u:p@127.0.0.1/x")).toThrow();
    expect(() => assertSafeDatabaseUrl("postgres://u:p@ep-cool.eu-west-2.aws.neon.tech/neondb")).not.toThrow();
  });

  it("cleans hosted connection strings for postgres.js", () => {
    // Shape of POSTGRES_URL from Vercel's Supabase integration (transaction pooler).
    expect(normaliseDatabaseUrl("postgres://postgres.abc:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x")).toBe(
      "postgres://postgres.abc:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    expect(normaliseDatabaseUrl("postgres://u:pw@db.abc.supabase.co:5432/postgres?pgbouncer=true")).toBe("postgres://u:pw@db.abc.supabase.co:5432/postgres?sslmode=require");
    expect(normaliseDatabaseUrl("postgres://u:pw@127.0.0.1:5544/postgres")).toBe("postgres://u:pw@127.0.0.1:5544/postgres");
    expect(databaseUrlFromEnv({ POSTGRES_URL: "postgres://x" })).toBe("postgres://x");
    expect(databaseUrlFromEnv({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" })).toBe("postgres://a");
    expect(databaseUrlFromEnv({})).toBeUndefined();
  });

  it("migrates an in-memory PGlite database", async () => {
    const db = await connectPglite({ memory: true });
    await db.insert(companies).values({ name: "Test", slug: "test", joinCode: "TEST" });
    const rows = await db.select().from(companies);
    expect(rows).toHaveLength(1);
  });
});

describe("PGlite lockfile", () => {
  it("refuses a directory held by another live process and takes over a stale lock", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "gq-")), "pglite");

    writeFileSync(`${dir}.lock`, String(process.ppid));
    expect(() => acquireLock(dir)).toThrow(/open in another process/);

    writeFileSync(`${dir}.lock`, "999999");
    const release = acquireLock(dir);
    expect(existsSync(`${dir}.lock`)).toBe(true);
    release();
    expect(existsSync(`${dir}.lock`)).toBe(false);
  });
});
