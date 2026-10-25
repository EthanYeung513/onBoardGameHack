import type { z } from "zod";
import { api } from "@convex/_generated/api";
import { SCAN_ANALYSE_SYSTEM_PROMPT } from "@/lib/prompts";
import { scanFindingsSchema, type ScanFindings, type StoredFindings } from "@/lib/schemas/scan-findings";
import type { StageDefinition } from "../types";

// PRD F6, ported from the legacy analyse stage: crawled pages → validated findings (category,
// product summary, features, audience, candidate people/terms/rituals), every item citing the
// crawled URLs that support it → `scans.findings`. Offline, a labelled stand-in quotes the
// homepage's own copy and leaves the lists empty rather than guessing.

const PAGE_CHARS = 7000;
const TOTAL_CHARS = 70_000;

export const OFFLINE_FINDINGS_LABEL = "Offline stand-in: the site was not analysed (no LLM configured; set MUBIT_API_KEY and re-scan).";

type Page = { url: string; title: string; text: string };

export function analyseUserMessage(siteUrl: string, pages: Page[]) {
  let budget = TOTAL_CHARS;
  const parts: string[] = [];
  for (const p of pages) {
    if (budget <= 500) break;
    const body = p.text.slice(0, Math.min(PAGE_CHARS, budget));
    budget -= body.length;
    parts.push(`<page url="${p.url}" title="${p.title.replace(/"/g, "'")}">\n${body}\n</page>`);
  }
  return `Website: ${siteUrl}\n\nAllowed source URLs:\n${pages.map((p) => p.url).join("\n")}\n\nPages:\n${parts.join("\n\n")}`;
}

/** Deterministic, honest stand-in: the homepage's first real paragraph, nothing inferred. */
export function offlineFindings(companyName: string, pages: Page[]): ScanFindings {
  const home = pages[0];
  const para = home.text
    .split(/\n+/)
    .map((l) => l.replace(/[#*_`>[\]]|\(http[^)]*\)/g, "").trim())
    .find((l) => l.length >= 40);
  return {
    companyName,
    category: null,
    confidence: "low",
    productSummary: { text: para?.slice(0, 400) ?? home.title ?? companyName, sourceUrls: [home.url] },
    features: [],
    audience: [],
    people: [],
    terms: [],
    rituals: [],
  };
}

export const analyseStage: StageDefinition = {
  name: "analyse",
  maxAttempts: 3,
  async run(ctx) {
    const scan = ctx.scan;
    if (!scan) throw new Error("analyse needs a scan");
    if (scan.findings) return { done: true, summary: "findings already written for this scan" };
    // Cheap re-scan: nothing on the site changed since the last scan → reuse its analysis.
    const ch = scan.changes;
    if (ch && ch.added + ch.changed + ch.removed === 0) {
      const prev = await ctx.convex.query(api.scanWorker.previousScan, { spaceId: ctx.space._id, scanId: scan._id });
      if (prev) {
        await ctx.convex.mutation(api.scanWorker.saveFindings, { scanId: scan._id, findings: { ...(prev.findings as object), reusedFrom: prev.scanId } });
        await ctx.event("info", `No page changed since the last scan, so its company analysis was reused (no model call)`, { step: "analyse", reused: true });
        return { done: true, summary: "unchanged since last scan, analysis reused" };
      }
    }
    const all = await ctx.convex.query(api.scanWorker.listCrawlPages, { scanId: scan._id, maxChars: PAGE_CHARS });
    const pages = all.filter((p) => p.text.trim().length > 0);
    if (!pages.length) throw new Error("No pages were read, so there is nothing to analyse");
    // Homepage first, then the order pages were read in (ranked).
    pages.sort((a, b) => Number(b.url.replace(/\/$/, "") === scan.url.replace(/\/$/, "")) - Number(a.url.replace(/\/$/, "") === scan.url.replace(/\/$/, "")));

    await ctx.event("info", `Understanding your company from ${pages.length} pages`, { step: "analyse", pages: pages.length });
    const allowed = new Set(pages.map((p) => p.url));
    const res = await ctx.llm.json({
      task: "scan_analyse",
      system: SCAN_ANALYSE_SYSTEM_PROMPT,
      user: analyseUserMessage(scan.url, pages),
      schema: scanFindingsSchema(allowed) as z.ZodType<ScanFindings>,
      offline: () => offlineFindings(ctx.space.name, pages),
    });
    const findings: StoredFindings = {
      ...res.value,
      mode: res.mode,
      model: res.model,
      generatedAt: Date.now(),
      ...(res.mode === "offline" ? { label: OFFLINE_FINDINGS_LABEL } : {}),
    };
    await ctx.convex.mutation(api.scanWorker.saveFindings, { scanId: scan._id, findings });
    const f = findings;
    if (f.mode === "live") {
      await ctx.event("info", `We think ${f.companyName} is ${f.category ?? "hard to categorise from its site"}`, { step: "analyse", confidence: f.confidence });
    } else {
      await ctx.event("warn", OFFLINE_FINDINGS_LABEL, { step: "analyse", standIn: true });
    }
    const counts = `${f.features.length} features, ${f.audience.length} audiences, ${f.people.length} people, ${f.terms.length} terms, ${f.rituals.length} rituals`;
    return { done: true, summary: f.mode === "live" ? counts : `offline stand-in (${counts})` };
  },
};
