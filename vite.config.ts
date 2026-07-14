/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
