import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  const input: Record<string, string> = {
    game: r('./index.html'),
  };
  // The two-iframe Flaxia mock parent is a development tool only.
  if (mode !== 'production') input.harness = r('./dev/harness.html');

  return {
    // Flaxia games run from an opaque origin and may be served under any path.
    // Relative URLs keep the build portable.
    base: './',
    publicDir: 'public',
    resolve: {
      alias: {
        '@': r('./src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input,
        output: {
          manualChunks(id) {
            if (id.includes('@pixiv/three-vrm')) return 'vrm';
            if (id.includes('node_modules/three')) return 'three';
            return undefined;
          },
        },
      },
    },
  };
});
