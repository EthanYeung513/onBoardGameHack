// Prepares the Supabase project from a management access token.
// 1. Finds the project (SUPABASE_PROJECT_REF, or the only project on the account).
// 2. Writes its URL, anon key and service role key into .env.local.
// 3. Applies supabase/migrations/*.sql that have not run yet.
// 4. Adds redirect URLs to Supabase Auth (localhost plus any passed with --redirect).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN_API;
if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token)");
const api = "https://api.supabase.com/v1";
const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };

async function mgmt<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function sql<T = unknown>(ref: string, query: string): Promise<T> {
  return mgmt<T>(`/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query }) });
}

function upsertEnvFile(path: string, values: Record<string, string>) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  writeFileSync(path, lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n");
}

async function main() {
  const args = process.argv.slice(2);
  const redirects = args.flatMap((a, i) => (a === "--redirect" ? [args[i + 1]] : []));

  const projects = await mgmt<Array<{ id: string; name: string; status: string }>>("/projects");
  const ref = process.env.SUPABASE_PROJECT_REF ?? (projects.length === 1 ? projects[0].id : undefined);
  if (!ref) throw new Error(`Set SUPABASE_PROJECT_REF; account has ${projects.length} projects: ${projects.map((p) => `${p.name}=${p.id}`).join(", ")}`);
  console.log(`project ${ref}`);

  const keys = await mgmt<Array<{ name: string; api_key: string }>>(`/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("anon or service_role key not returned");
  upsertEnvFile(".env.local", {
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    SUPABASE_PROJECT_REF: ref,
  });
  console.log("wrote Supabase URL and keys to .env.local");

  await sql(ref, "create table if not exists public._app_migrations (name text primary key, applied_at timestamptz not null default now()); alter table public._app_migrations enable row level security;");
  const done = new Set((await sql<Array<{ name: string }>>(ref, "select name from public._app_migrations")).map((r) => r.name));
  for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) {
      console.log(`migration ${file} already applied`);
      continue;
    }
    const body = readFileSync(`supabase/migrations/${file}`, "utf8");
    await sql(ref, `${body}\ninsert into public._app_migrations (name) values ('${file.replace(/'/g, "''")}');`);
    console.log(`migration ${file} applied`);
  }

  const auth = await mgmt<{ uri_allow_list?: string; site_url?: string }>(`/projects/${ref}/config/auth`);
  const allow = new Set((auth.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const r of ["http://localhost:3000/**", ...redirects.map((u) => `${u.replace(/\/$/, "")}/**`)]) allow.add(r);
  const site = redirects[0] ?? auth.site_url ?? "http://localhost:3000";
  await mgmt(`/projects/${ref}/config/auth`, {
    method: "PATCH",
    body: JSON.stringify({ uri_allow_list: [...allow].join(","), site_url: site }),
  });
  console.log(`auth redirect URLs: ${[...allow].join(", ")}; site_url ${site}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
