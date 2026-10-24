// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { normalizeHost, slugify } from "@convex/lib/slug";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);

async function setup() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => {
    const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
    return { userId, as: t.withIdentity({ subject: `${userId}|session` }) };
  };
  return { t, user };
}

describe("spaces + roles", () => {
  it("creates a space with the caller as owner and a unique slug", async () => {
    const { t, user } = await setup();
    const dana = await user("dana@acme.com");
    const a = await dana.as.mutation(api.spaces.create, { name: "Acme Pay", website: "https://www.AcmePay.com/about" });
    const b = await dana.as.mutation(api.spaces.create, { name: "Acme Pay", website: "acmepay.com" });
    expect(a.slug).toBe("acme-pay");
    expect(b.slug).toBe("acme-pay-2");
    const mine = await dana.as.query(api.spaces.mine, {});
    expect(mine.map((s) => [s.host, s.role])).toEqual([
      ["acmepay.com", "owner"],
      ["acmepay.com", "owner"],
    ]);
    const audits = await t.run((ctx) => ctx.db.query("audit_events").collect());
    expect(audits.filter((e) => e.kind === "space.created")).toHaveLength(2);
    expect(await dana.as.query(api.users.viewer, {})).toMatchObject({ home: "/dashboard" });
  });

  it("rejects signed-out callers, outsiders and hires on manager-only writes", async () => {
    const { t, user } = await setup();
    const owner = await user("owner@acme.com");
    const outsider = await user("eve@evil.com");
    const hire = await user("hire@acme.com");
    const { spaceId } = await owner.as.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
    await t.run((ctx) => ctx.db.insert("space_members", { spaceId, userId: hire.userId, role: "hire" }));

    await expect(t.query(api.spaces.get, { spaceId })).rejects.toThrow(/401/);
    await expect(outsider.as.query(api.spaces.get, { spaceId })).rejects.toThrow(/403/);
    await expect(hire.as.query(api.spaces.get, { spaceId })).resolves.toMatchObject({ role: "hire" });
    await expect(hire.as.mutation(api.spaces.update, { spaceId, name: "Hacked" })).rejects.toThrow(/403/);
    await expect(owner.as.mutation(api.spaces.update, { spaceId, autoApproveThreshold: 2 })).rejects.toThrow(/422/);
    await owner.as.mutation(api.spaces.update, { spaceId, name: "Acme Inc" });
    expect((await owner.as.query(api.spaces.get, { spaceId })).name).toBe("Acme Inc");
  });

  it("validates the website and new users are sent to space creation", async () => {
    const { user } = await setup();
    const u = await user("new@acme.com");
    expect(await u.as.query(api.users.viewer, {})).toMatchObject({ home: "/space/new" });
    await expect(u.as.mutation(api.spaces.create, { name: "X", website: "not a site" })).rejects.toThrow(/422/);
    await expect(u.as.mutation(api.spaces.create, { name: " ", website: "acme.com" })).rejects.toThrow(/422/);
  });
});

describe("slug helpers", () => {
  it("normalises hosts and slugs", () => {
    expect(normalizeHost("WWW.Example.co.uk/path?q=1")).toBe("example.co.uk");
    expect(() => normalizeHost("localhost")).toThrow();
    expect(slugify("Ünïcode & Co!")).toBe("unicode-co");
    expect(slugify("!!!")).toBe("space");
  });
});
