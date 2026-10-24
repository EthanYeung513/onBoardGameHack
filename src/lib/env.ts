import { z } from "zod";

// Single entry point for configuration. Several variables accept an alternate name because the
// hosting environments in use expose the same secret under different keys.

const DEFAULT_CLOUDFLARE_ACCOUNT_ID = "e0b6f5d65bd9a41858c2cb8d24ac4f50";

const bool = z
  .string()
  .optional()
  .transform((v) => v === undefined || v === "" ? undefined : ["1", "true", "yes", "on"].includes(v.toLowerCase()));

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_ACCESS_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).default(DEFAULT_CLOUDFLARE_ACCOUNT_ID),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  MUBIT_API_KEY: z.string().min(1).optional(),
  MUBIT_ENDPOINT: z.string().url().default("https://api.mubit.ai"),
  MUBIT_GATEWAY_ENABLED: bool,
  VERCEL_TOKEN: z.string().min(1).optional(),
  APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

function pick(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function read(): Env {
  const parsed = schema.safeParse({
    ANTHROPIC_API_KEY: pick("ANTHROPIC_API_KEY"),
    ANTHROPIC_MODEL: pick("ANTHROPIC_MODEL"),
    ANTHROPIC_EFFORT: pick("ANTHROPIC_EFFORT"),
    NEXT_PUBLIC_SUPABASE_URL: pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: pick("SUPABASE_SERVICE_ROLE_KEY"),
    SUPABASE_ACCESS_TOKEN: pick("SUPABASE_ACCESS_TOKEN", "SUPABASE_TOKEN_API"),
    CLOUDFLARE_ACCOUNT_ID: pick("CLOUDFLARE_ACCOUNT_ID"),
    CLOUDFLARE_API_TOKEN: pick("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_WEB_CRAWLER_API"),
    MUBIT_API_KEY: pick("MUBIT_API_KEY", "MUBIT_API_TOKEN"),
    MUBIT_ENDPOINT: pick("MUBIT_ENDPOINT"),
    MUBIT_GATEWAY_ENABLED: pick("MUBIT_GATEWAY_ENABLED"),
    VERCEL_TOKEN: pick("VERCEL_TOKEN", "VERCEL_API_KEY"),
    APP_URL: pick("APP_URL") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration (${issues})`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= read();
  return cached;
}

/** Gateway is on when explicitly enabled, or when unset and a Mubit key exists. */
export function gatewayEnabled(e: Env = env()): boolean {
  return e.MUBIT_GATEWAY_ENABLED ?? Boolean(e.MUBIT_API_KEY);
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === null || v === "") throw new Error(`Missing required environment variable ${String(key)}`);
  return v as NonNullable<Env[K]>;
}

/** Test hook: forget the cached configuration. */
export function resetEnvCache() {
  cached = undefined;
}
