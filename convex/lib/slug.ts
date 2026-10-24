/** "https://www.Acme-Pay.com/about" → "acme-pay.com". Throws on anything that isn't a web URL. */
export function normalizeHost(website: string): string {
  const raw = website.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) throw new Error("Not a website URL");
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "space";
}
