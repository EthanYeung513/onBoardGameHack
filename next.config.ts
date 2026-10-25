import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Read from disk at runtime, so serverless bundles (Vercel) must include them: migrations run on first
  // connect, and demo reset re-seeds from the handbook.
  outputFileTracingIncludes: {
    "/api/**/*": ["./drizzle/**/*", "./content/**/*"],
  },
  // `/` is the mockup's landing page served verbatim from public/ (index.html + assets/, copied from
  // `main`) so its layout, burger menu and animations match exactly (DECISIONS.md D-18).
  rewrites: async () => ({ beforeFiles: [{ source: "/", destination: "/index.html" }], afterFiles: [], fallback: [] }),
  redirects: async () => [{ source: "/login.html", destination: "/login", permanent: false }],
};

export default nextConfig;
