/**
 * Builds the demo as a static site, for GitHub Pages.
 *
 * `base: './'` keeps every asset URL relative, so the site works from
 * whatever subpath Pages serves it under (`/<repo>/`) without naming it here.
 *
 * Two pages: the React examples, and `demo/element.html`, which uses the
 * standalone `<pivoette-table>` the way a host page would — through one
 * classic script tag. That script is the element build itself, served from
 * `dist-element/` as the public directory, so `pnpm build:element` has to
 * have run first, in dev as in a build.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'dist-element',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        element: resolve(__dirname, 'demo/element.html'),
      },
    },
  },
});
