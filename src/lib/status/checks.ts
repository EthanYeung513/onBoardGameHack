import { complete } from "@/lib/llm/client";
import { anthropicClient } from "@/lib/llm/client";
import { env } from "@/lib/env";
import { renderMarkdown, screenshot } from "@/lib/crawl/cloudflare";
import { probeMubitMemory } from "@/lib/memory/mubit-provider";
import { supabaseAdmin } from "@/lib/supabase/admin";

// One minimal real call per service. Shared by scripts/check-env.ts and the /status page.

export interface CheckResult {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
  /** Optional checks report but do not fail the run. */
  optional?: boolean;
}

async function timed(name: string, fn: () => Promise<string>, optional = false): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t0, detail, optional };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t0, detail: err instanceof Error ? err.message.slice(0, 300) : String(err), optional };
  }
}

export async function checkAnthropicDirect() {
  return timed(
    "Anthropic (direct)",
    async () => {
      const e = env();
      if (!e.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set here; the key is registered in Mubit and calls use the gateway");
      const r = await anthropicClient("direct").messages.create({
        model: e.ANTHROPIC_MODEL,
        max_tokens: 200,
        output_config: { effort: e.ANTHROPIC_EFFORT },
        messages: [{ role: "user", content: "Reply with one short sentence." }],
      });
      return `${r.model}: ${r.content.find((b) => b.type === "text")?.text ?? ""}`;
    },
    true,
  );
}

export async function checkSupabase() {
  return timed("Supabase (db + storage)", async () => {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("health").select("id, note").eq("id", 1).single();
    if (error) throw new Error(`select health: ${error.message}`);
    const path = `env-check/${Date.now()}.txt`;
    const up = await sb.storage.from("assets").upload(path, new Blob(["ok"], { type: "text/plain" }), { upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const signed = await sb.storage.from("assets").createSignedUrl(path, 60);
    if (signed.error || !signed.data) throw new Error(`sign: ${signed.error?.message}`);
    const body = await (await fetch(signed.data.signedUrl)).text();
    await sb.storage.from("assets").remove([path]);
    if (body !== "ok") throw new Error(`signed URL returned ${JSON.stringify(body.slice(0, 60))}`);
    return `health row ${data.id} (${data.note}); signed URL round trip ok`;
  });
}

export async function checkCloudflare() {
  return timed("Cloudflare Browser Rendering", async () => {
    const md = await renderMarkdown("https://example.com");
    if (!/example domain/i.test(md)) throw new Error("markdown did not contain the expected title");
    const png = await screenshot("https://example.com", { width: 800, height: 600 });
    return `markdown ${md.length} chars; screenshot ${png.byteLength} bytes`;
  });
}

export async function checkMubitGateway() {
  return timed("Mubit gateway (Anthropic)", async () => {
    const r = await complete({ max_tokens: 200, messages: [{ role: "user", content: "Reply with one short sentence." }] }, { projectId: "env-check", task: "env-check" });
    if (r.route !== "gateway") throw new Error(`call used ${r.route}, gateway unavailable`);
    return `${r.message.model} with output_config.effort=${env().ANTHROPIC_EFFORT}: ${r.text.slice(0, 80)}`;
  });
}

export async function checkMubitMemory() {
  return timed(
    "Mubit memory SDK",
    async () => {
      const r = await probeMubitMemory();
      if (!r.ok) throw new Error(`not supported for this key, using the Supabase memory store instead. ${r.error ?? ""}`);
      return "remember and recall ok";
    },
    true,
  );
}

export async function checkVercel() {
  return timed("Vercel", async () => {
    const token = env().VERCEL_TOKEN;
    if (!token) throw new Error("VERCEL_TOKEN not set");
    const res = await fetch("https://api.vercel.com/v9/projects?limit=20", { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as { projects?: Array<{ name: string }>; error?: { message: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    return `${json.projects?.length ?? 0} projects: ${(json.projects ?? []).map((p) => p.name).join(", ") || "none"}`;
  });
}

export async function runAllChecks(): Promise<CheckResult[]> {
  // Cloudflare is rate limited, so it runs alone; the rest run in parallel.
  const parallel = await Promise.all([checkAnthropicDirect(), checkSupabase(), checkMubitGateway(), checkMubitMemory(), checkVercel()]);
  const cf = await checkCloudflare();
  const [anthropic, supabase, gateway, mem, vercel] = parallel;
  return [anthropic, supabase, cf, gateway, mem, vercel];
}
