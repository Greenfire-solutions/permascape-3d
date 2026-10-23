import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 8141 proxies the API to the real server on 8140.
export default defineConfig({
  plugins: [react()],
  server: { port: 8141, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8140' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
