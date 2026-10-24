import { env, requireEnv } from "@/lib/env";

// Cloudflare Browser Rendering. The free plan allows little browser time and a low request rate,
// so every call is spaced and retried on 429 with backoff.

const MIN_GAP_MS = 2500;
let lastCall = 0;

async function pace() {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function call(path: "markdown" | "screenshot", body: Record<string, unknown>, attempts = 4): Promise<Response> {
  const e = env();
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  const url = `https://api.cloudflare.com/client/v4/accounts/${e.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/${path}`;
  let last: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    await pace();
    last = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (last.status !== 429 && last.status < 500) return last;
    await new Promise((r) => setTimeout(r, 3000 * 2 ** i));
  }
  return last!;
}

export async function renderMarkdown(url: string): Promise<string> {
  const res = await call("markdown", { url });
  const json = (await res.json().catch(() => null)) as { success?: boolean; result?: string; errors?: Array<{ message: string }> } | null;
  if (!res.ok || !json?.success || typeof json.result !== "string") {
    throw new Error(`Cloudflare markdown failed (${res.status}): ${json?.errors?.map((e) => e.message).join(", ") ?? "no body"}`);
  }
  return json.result;
}

export async function screenshot(url: string, viewport = { width: 1440, height: 900 }): Promise<Uint8Array> {
  const res = await call("screenshot", { url, viewport, screenshotOptions: { type: "png" }, gotoOptions: { waitUntil: "networkidle2", timeout: 30000 } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudflare screenshot failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
