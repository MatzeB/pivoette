/**
 * Builds `<pivoette-table>` as a single self-contained file.
 *
 * React is bundled rather than externalized, and the CSS is inlined into the
 * JS, so the output can be dropped into any page with one <script> tag and no
 * build step on the other side.
 */
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Fold the emitted stylesheet into the JS as `__PIVOETTE_CSS__`.
 *
 * The element adopts it into a shadow root, where a separate .css file could
 * not reach it — document stylesheets do not cross the shadow boundary.
 */
function inlineCss(): Plugin {
  return {
    name: 'pivoette:inline-css',
    // After Vite's own CSS plugin, which emits the asset we are folding in.
    enforce: 'post',
    generateBundle(_options, bundle) {
      let css = '';
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && name.endsWith('.css')) {
          css += String(output.source);
          delete bundle[name];
        }
      }
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) {
          output.code = `var __PIVOETTE_CSS__=${JSON.stringify(css)};\n${output.code}`;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineCss()],
  // React reads this; without it the bundle keeps its dev-only warnings.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-element',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/element.tsx',
      formats: ['iife'],
      name: 'PivoetteElement',
      fileName: () => 'pivoette-element.js',
    },
  },
});
