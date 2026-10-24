import { z } from "zod";

// The single structured understanding of a site. Every later stage reads the confirmed version.

export const ProjectModel = z.object({
  companyName: z.string().min(1),
  productSummary: z.string().min(1),
  targetAudience: z.array(z.string().min(1)).min(1),
  valuePropositions: z.array(z.string().min(1)).min(1),
  features: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        sourceUrls: z.array(z.string().url()).min(1),
      }),
    )
    .min(1),
  keyUserActions: z.array(z.string().min(1)).min(1),
  toneOfVoice: z.object({
    adjectives: z.array(z.string()).min(1),
    description: z.string(),
    sampleCopy: z.array(z.string()).default([]),
  }),
  assets: z
    .array(
      z.object({
        url: z.string(),
        role: z.enum(["logo", "hero", "illustration", "product_shot", "icon", "screenshot", "other"]),
        description: z.string().default(""),
      }),
    )
    .default([]),
  gettingStarted: z.object({
    summary: z.string(),
    firstSteps: z.array(z.string()).min(1),
    successMoment: z.string(),
  }),
});
export type ProjectModel = z.infer<typeof ProjectModel>;
