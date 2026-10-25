// The hire-facing world: a static bundle built once (npm run build:world) into public/world/ and
// driven at runtime by one WorldData object (window.OB_WORLD, else ./world.json). Built with the
// root node_modules: one React (the games import it too) and Phaser 3 through the `phaser3` alias
// (the root `phaser` is v4, used by the Next app).
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  // Every URL relative, so the bundle works wherever index.html is served (/world/, /o/<slug> + <base>).
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^phaser$/, replacement: 'phaser3' },
      { find: /^@\//, replacement: `${here('../src')}/` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: here('../public/world'),
    emptyOutDir: true,
    // public/ already has an assets/ folder (sprites); keep Vite's hashed chunks apart from it
    assetsDir: '_app',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173 },
});
