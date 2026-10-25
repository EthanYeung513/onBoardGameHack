import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The hire-facing world is a Vite app (no next/image there): plain <img> is the right tool.
  { files: ["world/**"], rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", ".data/**", "next-env.d.ts", "drizzle/**", "convex/_generated/**", "public/assets/**", "public/world/**", "templates/**"]),
]);
