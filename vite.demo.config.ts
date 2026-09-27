/**
 * Builds the demo app as a static site, for GitHub Pages.
 *
 * `base: './'` keeps every asset URL relative, so the site works from
 * whatever subpath Pages serves it under (`/<repo>/`) without naming it here.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
});
