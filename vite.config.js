import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React client lives in ./client and is built into ./dist,
// which the Express server serves in production (npm start).
export default defineConfig({
  root: './client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
