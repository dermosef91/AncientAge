import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    port: 5173,
  },
});
