import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build runs from any path: GitHub Pages, Netlify, a subfolder.
  base: './',
  plugins: [react()],
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
