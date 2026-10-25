import { v } from "convex/values";
import { query } from "./_generated/server";
import { PACK_TYPES } from "../src/lib/flow/course-packs";

// Public, unauthenticated read for the shareable employee page `/join/<slug>` (a URL the deploy
// operator can turn into a QR code). Returns only what a new hire may see: the space name and
// brand tokens, and the course titles with their status. No facts, specs or member data.

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const space = await ctx.db.query("spaces").withIndex("by_slug", (q) => q.eq("slug", slug.toLowerCase())).first();
    if (!space) return null;
    const brand = space.brandProfileId
      ? await ctx.db.get(space.brandProfileId)
      : await ctx.db.query("brand_profiles").withIndex("by_space", (q) => q.eq("spaceId", space._id)).order("desc").first();
    const courses = (await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", space._id)).collect())
      .filter((c) => c.status !== "archived")
      .sort((a, b) => order(a.packType) - order(b.packType))
      .map((c) => ({
        id: c._id,
        title: c.title,
        icon: c.icon,
        building: c.building,
        game: c.game,
        desc: (c.spec as { desc?: string } | null)?.desc ?? null,
        live: c.status === "published",
      }));
    return { name: space.name, host: space.host, brand, courses };
  },
});

function order(packType: string) {
  const i = (PACK_TYPES as string[]).indexOf(packType);
  return i < 0 ? PACK_TYPES.length : i;
}
