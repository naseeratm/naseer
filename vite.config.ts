import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const currentDir = typeof import.meta.dirname !== 'undefined'
  ? import.meta.dirname
  : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Vendor bundles are intentionally lazy-loaded; keep warnings scoped to
      // bundles that are genuinely larger than the application entry chunk.
      chunkSizeWarningLimit: 850,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'three-engine',
                test: /node_modules\/(?:three)\//,
              },
              {
                name: 'charts',
                test: /node_modules\/(?:recharts|d3-|victory)/,
              },
              {
                name: 'document-tools',
                test: /node_modules\/(?:xlsx|jszip|mammoth)/,
              },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(currentDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
