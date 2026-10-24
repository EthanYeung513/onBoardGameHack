import { z } from "zod";

/** Request validation for the Orthogonal endpoints. Mirrors the request types in `types.ts`. */

const colour = z.string().min(1).max(64);

const step = z.object({
  id: z.string().min(1),
  title: z.string().max(200),
  description: z.string().max(1000),
  kind: z.enum(["welcome", "choice", "fields", "toggles", "done"]),
  badge: z.string().max(80),
  xp: z.number().int().min(0).max(10000),
  theme: z.object({ bg: colour, fg: colour, accent: colour, onAccent: colour }),
  options: z.array(z.string().max(120)).max(12).optional(),
  fields: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(200), kind: z.enum(["text", "select", "computed"]).optional() }))
    .max(12)
    .optional(),
  toggles: z.array(z.object({ title: z.string().max(80), description: z.string().max(200), on: z.boolean() })).max(12).optional(),
  chips: z.array(z.string().max(80)).max(12).optional(),
});

const siteUrl = z.string().min(1).max(2048);
const repo = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "Repository must look like owner/name")
  .nullable();

export const scanRequest = z.object({ url: z.string().max(2048) });

export const buildRequest = z.object({
  scanId: z.string().min(1),
  siteUrl,
  repo,
  description: z.string().max(4000),
});

export const shipRequest = z.object({
  siteUrl,
  repo,
  steps: z.array(step).min(1).max(30),
  connectors: z.object({ github: z.boolean(), vercel: z.boolean(), supabase: z.boolean(), cloudflare: z.boolean() }),
});
