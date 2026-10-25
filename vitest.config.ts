import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      "@convex": fileURLToPath(new URL("./convex", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "world/src/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // @convex-dev/auth imports `next/server` without an extension; let Vite resolve it.
    server: { deps: { inline: ["@convex-dev/auth"] } },
    // PGlite's WASM start-up is slow when every test file boots its own database in parallel.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
