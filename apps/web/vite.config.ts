import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // noVNC uses top-level await.
  build: { target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3000', ws: true }, '/fixture': 'http://127.0.0.1:3000' } },
});
