import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Read from disk at runtime, so serverless bundles (Vercel) must include them: migrations run on first
  // connect, and demo reset re-seeds from the handbook.
  outputFileTracingIncludes: {
    "/api/**/*": ["./drizzle/**/*", "./content/**/*"],
  },
  // The original Webflow export of the landing page, kept for reference (see DECISIONS.md D-16).
  rewrites: async () => [{ source: "/classic", destination: "/classic/index.html" }],
};

export default nextConfig;
