import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite loads this file via esbuild, so ESM syntax works regardless of
// the surrounding package.json "type" field.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
