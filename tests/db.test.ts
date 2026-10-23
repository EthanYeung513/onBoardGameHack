import { describe, expect, it } from "vitest";
import { assertSafeDatabaseUrl, connectPglite } from "@/db/client";
import { companies } from "@/db/schema";

describe("db client", () => {
  it("refuses the work DB tunnel on localhost:5432", () => {
    expect(() => assertSafeDatabaseUrl("postgres://u:p@localhost:5432/apricot_dev_db")).toThrow(/work DB tunnel/);
    expect(() => assertSafeDatabaseUrl("postgres://u:p@127.0.0.1/x")).toThrow();
    expect(() => assertSafeDatabaseUrl("postgres://u:p@ep-cool.eu-west-2.aws.neon.tech/neondb")).not.toThrow();
  });

  it("migrates an in-memory PGlite database", async () => {
    const db = await connectPglite({ memory: true });
    await db.insert(companies).values({ name: "Test", slug: "test", joinCode: "TEST" });
    const rows = await db.select().from(companies);
    expect(rows).toHaveLength(1);
  });
});
