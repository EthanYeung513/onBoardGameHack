import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";

/**
 * The asset pipeline drops a company's extracted logo at public/brand/<slug>.(png|svg|ico|webp).
 * When it's there, pages scoped to that company use it as their favicon; otherwise the site icon.
 */
const LOGO_EXTS = ["png", "svg", "ico", "webp"];

export function extractedLogoUrl(companySlug: string): string | null {
  for (const ext of LOGO_EXTS) {
    const rel = `brand/${companySlug}.${ext}`;
    if (fs.existsSync(path.join(process.cwd(), "public", rel))) return `/${rel}`;
  }
  return null;
}

/** Browser chrome for a company's deployment: its name as the title, its extracted logo as the favicon. */
export function companyMetadata(company: { name: string; slug: string } | null): Metadata {
  const icon = company ? extractedLogoUrl(company.slug) : null;
  return { title: company?.name ?? "Orthogonal", ...(icon ? { icons: { icon } } : {}) };
}
