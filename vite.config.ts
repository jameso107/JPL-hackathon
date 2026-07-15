/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the heavyweights: smaller chunks render faster on Vercel's
        // 2-core builder and cache independently in the browser.
        manualChunks: {
          three: ['three'],
          recharts: ['recharts'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    proxy: {
      // Local dev: the Express proxy (server/index.ts) holds the ChatHPC key.
      // On Vercel the same path is served by the api/ serverless function.
      '/api': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
