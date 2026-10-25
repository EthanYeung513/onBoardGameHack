import { z } from "zod";
import { api } from "@convex/_generated/api";
import { applyModelHints, buildCandidates, type BrandCandidates, type HtmlEvidence } from "@/lib/brand/candidates";
import { pickBrandTokens, type PickedTokens } from "@/lib/brand/pick";
import { svgLogoTone } from "@/lib/brand/themes";
import { recommendBrandTokens } from "@/lib/brand/recommend";
import { dembrandtAvailable, htmlCssEvidence, runDembrandt } from "@/lib/design/evidence";
import { BRAND_NORMALISE_SYSTEM_PROMPT } from "@/lib/prompts";
import { loadImage, storeBytes } from "../storage";
import type { StageContext, StageDefinition } from "../types";

// PRD F5: evidence first (dembrandt on local Chromium + the HTML/CSS fallback), every candidate
// kept with where it was found, the model labels candidates (never invents values), and
// `pickBrandTokens` chooses the final tokens → one `brand_profiles` row per scan. Offline, the
// labels come only from the site's own evidence and the profile says `quality: "offline"`.

export const BrandLabels = z.object({
  companyName: z.string().nullable(),
  roles: z.object({ primary: z.string().nullable(), accent: z.string().nullable(), surface: z.string().nullable(), text: z.string().nullable() }),
  colorNames: z.record(z.string(), z.string()),
  headline: z.string().nullable(),
  body: z.string().nullable(),
  radius: z.string().nullable(),
  voice: z.string().min(1),
});
export type BrandLabels = z.infer<typeof BrandLabels>;

export const OFFLINE_VOICE = "Offline stand-in: tone of voice was not analysed (no LLM configured — set MUBIT_API_KEY and re-scan).";

export interface DesignDeps {
  dembrandtAvailable: () => boolean;
  runDembrandt: (url: string) => Promise<Record<string, unknown>>;
  htmlCssEvidence: (url: string) => Promise<Record<string, unknown>>;
  loadImage: typeof loadImage;
  storeBytes: typeof storeBytes;
}

const list = (label: string, items: { value: string; count: number; evidence: string[] }[]) =>
  `${label}:\n${items.map((c) => `- ${c.value} (${c.count}×; ${c.evidence.slice(0, 3).join("; ")})`).join("\n") || "- none found"}`;

export function brandUserMessage(url: string, c: BrandCandidates) {
  return [
    `Website: ${url}`,
    `Evidence source: ${c.source === "dembrandt" ? "rendered page (dembrandt) + HTML/CSS" : "HTML/CSS only"}`,
    list("Colour candidates", c.palette),
    list("Headline font candidates", c.headline),
    list("Body font candidates", c.body),
    list("Corner radius candidates", c.radius),
    list("Company name candidates", c.companyName),
    `Copy sample: ${c.description ?? "(no meta description)"}`,
  ].join("\n\n");
}

/** Model labels must point at real candidates; anything else goes back to the model. */
function labelsSchema(c: BrandCandidates) {
  const hexes = new Set(c.palette.map((p) => p.value));
  return BrandLabels.superRefine((l, ctx) => {
    for (const [role, hex] of Object.entries(l.roles)) {
      if (hex && !hexes.has(hex.toLowerCase())) ctx.addIssue({ code: "custom", path: ["roles", role], message: `${hex} is not one of the colour candidates` });
    }
  });
}

async function storeLogos(ctx: StageContext, deps: DesignDeps, c: BrandCandidates) {
  const refs: { kind: "mark" | "wordmark" | "favicon"; url: string; format: string; tone?: "light" | "dark" }[] = [];
  for (const kind of ["logo", "favicon"] as const) {
    const options = c.logos.filter((l) => (kind === "favicon" ? l.kind === "favicon" : l.kind !== "favicon"));
    for (const l of options.slice(0, 2)) {
      try {
        const img = await deps.loadImage(l.src);
        const { url } = await deps.storeBytes(ctx, img.bytes, img.contentType);
        const tone = img.format === "svg" ? svgLogoTone(new TextDecoder().decode(img.bytes)) : null;
        refs.push({ kind: l.kind, url, format: img.format, ...(tone ? { tone } : {}) });
        break;
      } catch (err) {
        await ctx.event("warn", `Couldn't copy the ${kind} (${l.evidence}): ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }
  return refs;
}

function profileFrom(p: PickedTokens, labels: BrandLabels | null) {
  const palette = (["primary", "accent", "surface", "text"] as const).map((role) => ({ role, hex: p.colors[role].value, name: p.colors[role].name ?? role }));
  const font = (f: PickedTokens["headline"]) => ({ family: f.value, fallback: f.fallback, ...(f.weight ? { weight: f.weight } : {}) });
  return {
    palette,
    typography: { heading: font(p.headline), body: font(p.body), notes: `Headline: ${p.headline.reason}. Body: ${p.body.reason}.` },
    radius: p.radius?.value,
    voice: labels?.voice ?? OFFLINE_VOICE,
  };
}

export function createExtractDesignStage(deps: DesignDeps): StageDefinition {
  return {
    name: "extract_design",
    maxAttempts: 3,
    async run(ctx) {
      const scan = ctx.scan;
      if (!scan) throw new Error("extract_design needs a scan");
      const existing = await ctx.convex.query(api.scanWorker.brandProfileForScan, { scanId: scan._id });
      if (existing) {
        // A retry after the profile was saved: only the theme options may still be missing.
        if (!existing.themes) await ctx.convex.mutation(api.brand.saveThemes, { spaceId: ctx.space._id, style: (existing.candidates as BrandCandidates | undefined)?.style });
        return { done: true, summary: "brand already extracted for this scan" };
      }
      // Cheap re-scan: the homepage (where the brand evidence lives) is unchanged and the space
      // already has a brand → keep it (and the manager's Design-tab choices) without re-extracting.
      if (scan.changes?.home === "unchanged" && ctx.space.brandProfileId) {
        await ctx.event("info", "Homepage unchanged since the last scan — kept your current brand (no re-extraction)", { step: "brand", reused: true });
        return { done: true, summary: "brand unchanged — kept current tokens" };
      }

      await ctx.event("info", "Extracting brand identity (logo, colors, typography)", { step: "brand" });
      // The rendered page (dembrandt) and the HTML/CSS read run side by side.
      const rendered = deps.dembrandtAvailable()
        ? deps.runDembrandt(scan.url).catch(async (err) => {
            await ctx.event("warn", `Rendered-page extraction failed, using the HTML and CSS only: ${(err as Error).message.slice(0, 200)}`);
            return null;
          })
        : ctx.event("info", "No local browser for rendered-page extraction — reading brand tokens from the HTML and CSS").then(() => null);
      const [dembrandt, html] = await Promise.all([rendered, deps.htmlCssEvidence(scan.url) as Promise<HtmlEvidence>]);
      await ctx.progress(0.4);
      const candidates = buildCandidates(html, dembrandt);
      if (!candidates.palette.length) throw new Error(`No colours found on ${scan.url}`);

      const res = await ctx.llm.json({
        task: "scan_brand",
        system: BRAND_NORMALISE_SYSTEM_PROMPT,
        user: brandUserMessage(scan.url, candidates),
        schema: labelsSchema(candidates) as z.ZodType<BrandLabels>,
        // Offline stand-in: no model labels; the pick uses only the site's own evidence.
        offline: () => ({ companyName: null, roles: { primary: null, accent: null, surface: null, text: null }, colorNames: {}, headline: null, body: null, radius: null, voice: OFFLINE_VOICE }),
      });
      const labels = res.mode === "live" ? res.value : null;
      if (labels) applyModelHints(candidates, labels);
      const picked = pickBrandTokens(candidates);
      await ctx.progress(0.7);

      const logoRefs = await storeLogos(ctx, deps, candidates);
      const quality = res.mode === "offline" ? "offline" : dembrandt ? "full" : "partial";
      const saved = await ctx.convex.mutation(api.scanWorker.saveBrandProfile, {
        spaceId: ctx.space._id,
        scanId: scan._id,
        ...profileFrom(picked, labels),
        logoRefs,
        quality,
        candidates: { ...candidates, picked, labelledBy: res.mode === "live" ? res.model : "offline-stand-in" },
        companyName: picked.companyName?.value,
      });
      const { primary, accent } = picked.colors;
      await ctx.event("info", `Brand identity: primary ${primary.value}, accent ${accent.value}, ${picked.headline.value} headlines${quality === "full" ? "" : ` (${quality})`}`, {
        step: "brand",
        palette: profileFrom(picked, labels).palette,
        quality,
        logos: logoRefs.length,
        tokensVersion: saved.tokensVersion,
      });
      // F37: rank the candidates with what managers chose before (Mubit `brand.recommend`, learned
      // ranker, heuristic) and apply the recommendation; the scan's own pick stays if it fails.
      try {
        await recommendBrandTokens(ctx, { ...candidates, picked }, { host: ctx.space.host, name: picked.companyName?.value ?? ctx.space.name });
      } catch (err) {
        await ctx.event("warn", `Brand recommendation unavailable, keeping the extracted tokens: ${err instanceof Error ? err.message : String(err)}`);
      }
      // D-34: the scan's output is a handful of theme options built from this identity.
      const themes = await ctx.convex.mutation(api.brand.saveThemes, { spaceId: ctx.space._id, style: candidates.style });
      await ctx.event("info", `${themes.themes} theme options ready${candidates.style?.glass ? " (frosted glass detected on the site)" : ""}`, { step: "themes", ...themes });
      return { done: true, summary: `primary ${primary.value}, ${picked.headline.value} headlines, ${quality}` };
    },
  };
}

export const extractDesignStage = createExtractDesignStage({
  dembrandtAvailable,
  // Bounded: the manager waits on this pass; past it, the HTML/CSS evidence alone is used.
  runDembrandt: (url) => runDembrandt(url, 35_000),
  htmlCssEvidence,
  loadImage,
  storeBytes,
});
