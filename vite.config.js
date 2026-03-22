import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // SSE endpoint — needs long timeout and no buffering
      '/api/progress': {
        target:       'http://localhost:3000',
        changeOrigin: true,
        timeout:      0,          // no timeout for long-lived SSE connections
      },
      '/api': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
      '/audio': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
      '/download': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir:     'dist',
    emptyOutDir: true,
  },
});
