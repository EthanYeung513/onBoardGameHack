/** Used when the visitor scans without typing anything, so the demo always has a site to show. */
export const DEMO_SITE = "lumen.energy";

/** "https://Lumen.energy/" → "lumen.energy". Empty input falls back to the demo site. */
export function normaliseSiteUrl(input: string): string {
  const url = input.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  return url || DEMO_SITE;
}

/** "lumen.energy/app" → "Lumen". */
export function siteNameOf(siteUrl: string): string {
  const host = siteUrl.split("/")[0].split(".")[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
}
