import { z } from "zod";
import { api } from "@convex/_generated/api";
import { BRAND_RECOMMEND_SYSTEM_PROMPT } from "@/lib/prompts";
import type { Embedder } from "@/worker/providers/embed";
import type { Llm } from "@/worker/providers/llm";
import type { StageContext } from "@/worker/types";
import { buildCompanyProfile, normaliseCandidates, profileText } from "./normalise";
import { FEATURE_VERSION, poolFeatures } from "./features";
import { FALLBACK_TOKENS, poolFor } from "./heuristic";
import { brandMemoryFromEnv, withTimeout, type BrandMemory } from "./memory";
import { learnedRecommend, nearestPrecedents, sameValue, type Target } from "./ranker";
import { BRAND_FIELDS, type BrandCandidates, type BrandField, type CompanyProfile, type DecisionRecord, type FieldRecommendation, type StoredRecommendation } from "./types";

// Scan-time brand recommendation (S19, D-27): precedents (similar companies' decisions, by Mubit
// embeddings) + the learned ranker + Mubit memory recall → the `brand.recommend` task through the
// Mubit adapter. Offline: the learned ranker ("learned"), or the heuristic with no history.

export const BRAND_RECOMMEND_TASK = "brand.recommend";

const pick = z.object({ recommended: z.string().min(1).max(80), reason: z.string().max(240) });
export const BrandRecommendOutput = z.object({ primary: pick, accent: pick, radius: pick, headline: pick });
export type BrandRecommendOutput = z.infer<typeof BrandRecommendOutput>;

export interface RecommendDeps {
  llm: Llm;
  embed: Embedder;
  /** Past decisions across all spaces (most recent last). */
  history: () => Promise<DecisionRecord[]>;
  memory?: BrandMemory | null;
  log?: (level: "info" | "warn", message: string, data?: Record<string, unknown>) => Promise<void>;
}

export type ProfileInput = Omit<CompanyProfile, "paletteSummary">;

function userMessage(profile: CompanyProfile, learned: ReturnType<typeof learnedRecommend>, c: BrandCandidates, precedents: unknown, memory: string) {
  const fields = Object.fromEntries(
    BRAND_FIELDS.map((f) => {
      const scores = new Map(learned[f].scores.map((s) => [s.value, s.score]));
      return [f, { candidates: learned[f].candidates.map((x) => ({ ...x, learnedScore: scores.get(x.value) ?? null })), learnedPick: learned[f].recommended, learnedReason: learned[f].reason }];
    }),
  );
  return JSON.stringify({ company: profile, surface: c.surface ?? "#ffffff", fields, precedents, rememberedPreferences: memory || null }, null, 1);
}

export async function computeRecommendation(deps: RecommendDeps, raw: unknown, input: ProfileInput): Promise<StoredRecommendation> {
  const log = deps.log ?? (async () => undefined);
  const c = normaliseCandidates(raw);
  const profile = buildCompanyProfile(input, c);
  const target: Target = { host: profile.host };
  try {
    [target.embedding] = await deps.embed.embed([profileText(profile)]);
    target.embeddingMode = deps.embed.mode;
  } catch (err) {
    await log("warn", `Brand precedent search without embeddings: ${(err as Error).message}`);
  }
  const history = await deps.history();
  const learned = learnedRecommend(c, history, target);
  const fields = {} as Record<BrandField, FieldRecommendation>;
  for (const f of BRAND_FIELDS) {
    const { candidates, recommended, reason, source } = learned[f];
    fields[f] = { candidates, recommended, reason, source };
  }
  let requestId: string | null = null;
  let model: string | undefined;

  if (deps.llm.live && BRAND_FIELDS.some((f) => learned[f].candidates.length)) {
    let memory = "";
    if (deps.memory) {
      try {
        memory = await withTimeout(deps.memory.recall(`Brand preferences for ${profile.host} (${profile.category ?? profile.industry ?? "company"}): ${profile.paletteSummary}`), 5000, "Mubit memory recall");
      } catch (err) {
        await log("warn", `Mubit memory recall failed, continuing without it: ${(err as Error).message.slice(0, 200)}`);
      }
    }
    try {
      const res = await deps.llm.json({
        task: BRAND_RECOMMEND_TASK,
        system: BRAND_RECOMMEND_SYSTEM_PROMPT,
        user: userMessage(profile, learned, c, nearestPrecedents(history, target), memory),
        schema: BrandRecommendOutput,
        validate: (v) =>
          BRAND_FIELDS.filter((f) => learned[f].candidates.length && !learned[f].candidates.some((x) => sameValue(f, x.value, v[f].recommended))).map(
            (f) => `${f}.recommended "${v[f].recommended}" is not one of the ${f} candidates`,
          ),
      });
      requestId = res.requestId;
      model = res.model;
      for (const f of BRAND_FIELDS) {
        const cur = fields[f];
        // A returning company's own past choice stays (the model sees it as a precedent too).
        if (!cur.candidates.length || learned[f].precedent) continue;
        const value = cur.candidates.find((x) => sameValue(f, x.value, res.value[f].recommended))!.value;
        fields[f] = { candidates: [cur.candidates.find((x) => x.value === value)!, ...cur.candidates.filter((x) => x.value !== value)], recommended: value, reason: res.value[f].reason, source: "mubit" };
      }
    } catch (err) {
      await log("warn", `Mubit brand.recommend failed, using the learned ranker: ${(err as Error).message.slice(0, 200)}`);
    }
  }

  // Accent features depend on the final primary.
  const features = Object.fromEntries(
    BRAND_FIELDS.map((f) => [f, poolFeatures(f, poolFor(f, c, fields.primary.recommended), { surface: c.surface, primary: fields.primary.recommended })]),
  ) as StoredRecommendation["features"];
  return { fields, requestId, companyProfile: profile, features, featureVersion: FEATURE_VERSION, embedding: target.embedding, embeddingMode: target.embeddingMode, model, computedAt: Date.now() };
}

export const tokensOf = (r: StoredRecommendation): Record<BrandField, string> =>
  Object.fromEntries(BRAND_FIELDS.map((f) => [f, r.fields[f].recommended || FALLBACK_TOKENS[f]])) as Record<BrandField, string>;

/**
 * Called by the extract_design stage instead of `pickBrandTokens(candidates)` (src/lib/brand/pick.ts), after it has
 * written the scan's brand_profiles row: computes the recommendation, stores it (and the
 * candidates) on the profile, applies the recommended tokens, and logs the scan line.
 */
export async function recommendBrandTokens(ctx: Pick<StageContext, "llm" | "embed" | "convex" | "space" | "event">, candidates: unknown, profile: ProfileInput, opts: { apply?: boolean; memory?: BrandMemory | null } = {}) {
  const recommendation = await computeRecommendation(
    {
      llm: ctx.llm,
      embed: ctx.embed,
      memory: opts.memory === undefined ? brandMemoryFromEnv() : opts.memory,
      history: () => ctx.convex.query(api.brand.history, { limit: 500 }) as Promise<DecisionRecord[]>,
      log: (level, message, data) => ctx.event(level, message, data),
    },
    candidates,
    profile,
  );
  await ctx.convex.mutation(api.brand.saveRecommendation, { spaceId: ctx.space._id, recommendation, apply: opts.apply ?? true });
  const p = recommendation.fields.primary;
  await ctx.event("info", `Recommended brand: ${p.recommended || "none found"} (${p.reason.split(/[,:]/)[0].slice(0, 60)})`, {
    sources: Object.fromEntries(BRAND_FIELDS.map((f) => [f, recommendation.fields[f].source])),
    requestId: recommendation.requestId,
  });
  return { tokens: tokensOf(recommendation), recommendation };
}
