import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard is served by Fastify from public/admin at the /admin prefix.
export default defineConfig({
  root: 'dashboard',
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
    sourcemap: false,
  },
});
