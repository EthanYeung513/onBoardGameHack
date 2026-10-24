import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Read from disk at runtime, so serverless bundles (Vercel) must include them: migrations run on first
  // connect, and demo reset re-seeds from the handbook.
  outputFileTracingIncludes: {
    "/api/**/*": ["./drizzle/**/*", "./content/**/*"],
  },
};

export default nextConfig;
