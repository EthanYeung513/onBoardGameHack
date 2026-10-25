import { api } from "@convex/_generated/api";
import { buildBundle } from "@/lib/onboarding/bundle";
import { buildOnboardingContent } from "@/lib/onboarding/content";
import { deployStatic, projectNameFor, vercelConfigFromEnv } from "@/lib/onboarding/vercel";
import type { StageDefinition } from "../types";

/**
 * Generate → deploy: package the space's onboarding world (mockup world + generated content) and
 * deploy it as the company's own Vercel project — the same project on every Generate, so the
 * company keeps one URL. Without a Vercel token: the labelled stand-in (served by this app at
 * `/o/<slug>` from the same content) — never a fake Vercel URL.
 */
export const deployStage: StageDefinition = {
  name: "deploy",
  maxAttempts: 2,
  async run(ctx) {
    const spaceId = ctx.space._id;
    const input = await ctx.convex.query(api.deploy.bundleInput, { spaceId });
    const content = buildOnboardingContent(input);
    if (!content.playable) {
      await ctx.convex.mutation(api.deploy.recordDeploy, { spaceId, ok: false, mode: "stand-in", error: "No playable course content yet — generate courses first" });
      return { done: true, summary: "nothing to deploy yet" };
    }
    await ctx.event("info", `Packaged ${content.COURSES.length} buildings, ${content.QUIZ.length} quiz questions, ${content.INBOX_CARDS.length} inbox cards, ${content.NPCS.length} people`);

    const cfg = vercelConfigFromEnv();
    if (!cfg) {
      await ctx.event("warn", `VERCEL_TOKEN not set — publishing the labelled stand-in at /o/${ctx.space.slug} instead of a Vercel project`);
      await ctx.convex.mutation(api.deploy.recordDeploy, { spaceId, ok: true, mode: "stand-in", url: `/o/${ctx.space.slug}` });
      return { done: true, summary: "stand-in published (no Vercel token)" };
    }

    const projectName = projectNameFor(ctx.space.slug);
    try {
      const res = await deployStatic(cfg, {
        projectName,
        files: buildBundle(content, "vercel"),
        onEvent: (msg) => ctx.event("info", msg),
      });
      await ctx.convex.mutation(api.deploy.recordDeploy, { spaceId, ok: true, mode: "vercel", url: res.url, projectId: res.projectId });
      return { done: true, summary: `deployed ${res.url}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A token without project rights (e.g. a read-only VERCEL_TOKEN before VERCEL_TOKEN_FULL is
      // provisioned) won't fix itself on retry: publish the labelled stand-in and say why.
      if (/→ 40[13]:/.test(message)) {
        await ctx.event("warn", `Vercel refused the deploy (${message.split("→ ")[1] ?? message}) — published the labelled stand-in at /o/${ctx.space.slug} instead`);
        await ctx.convex.mutation(api.deploy.recordDeploy, { spaceId, ok: true, mode: "stand-in", url: `/o/${ctx.space.slug}` });
        return { done: true, summary: "stand-in published (Vercel token lacks project permission)" };
      }
      if (ctx.job.attempt + 1 >= (deployStage.maxAttempts ?? 2)) {
        await ctx.convex.mutation(api.deploy.recordDeploy, { spaceId, ok: false, mode: "vercel", error: message.slice(0, 300) });
      }
      throw err;
    }
  },
};
