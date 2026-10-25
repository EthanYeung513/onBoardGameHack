import { z } from "zod";

// Validated output of the `analyse` scan stage → `scans.findings` (PRD F6). Every item cites the
// crawled URLs that support it; `scanFindingsSchema(allowed)` rejects any URL that wasn't crawled,
// and that rejection goes back to the model (bounded retries), never into the UI.

const cited = { sourceUrls: z.array(z.string()).min(1) };

export const ScanFindingsBase = z.object({
  companyName: z.string().min(1),
  category: z.string().min(1).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  productSummary: z.object({ text: z.string().min(1), ...cited }),
  features: z.array(z.object({ name: z.string().min(1), description: z.string().min(1), ...cited })).max(12),
  audience: z.array(z.object({ segment: z.string().min(1), ...cited })).max(8),
  people: z.array(z.object({ name: z.string().min(1), role: z.string().nullable(), ...cited })).max(20),
  terms: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1), ...cited })).max(20),
  rituals: z.array(z.object({ name: z.string().min(1), description: z.string().min(1), ...cited })).max(12),
});
export type ScanFindings = z.infer<typeof ScanFindingsBase>;

/** What is stored on the scan: the findings plus how they were produced. */
export type StoredFindings = ScanFindings & { mode: "live" | "offline"; model: string; generatedAt: number; label?: string };

export function scanFindingsSchema(allowed: Set<string>) {
  return ScanFindingsBase.superRefine((f, ctx) => {
    const check = (urls: string[], path: (string | number)[]) =>
      urls.forEach((u, i) => {
        if (!allowed.has(u)) ctx.addIssue({ code: "custom", path: [...path, "sourceUrls", i], message: `${u} is not one of the crawled pages` });
      });
    check(f.productSummary.sourceUrls, ["productSummary"]);
    for (const key of ["features", "audience", "people", "terms", "rituals"] as const) f[key].forEach((item, i) => check(item.sourceUrls, [key, i]));
  });
}
