import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    ".data/**",
    "next-env.d.ts",
    "drizzle/**",
    // The merged world app is a separate static site (own Vite build under world/);
    // its root scripts and vendored assets are not part of this app's lint scope.
    "world/**",
    "assets/**",
    "game.js",
    "state.js",
  ]),
]);
