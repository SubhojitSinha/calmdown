import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Static MV3 extension: the viewer is a plain extension page, no content script yet.
export default defineConfig({
  base: './',
  plugins: [
    {
      // KaTeX's stylesheet lists each font as woff2, woff and ttf. Chrome always takes woff2,
      // so the other two (~800 KB) are dropped from the CSS and never copied into dist/.
      name: 'katex-woff2-only',
      enforce: 'pre', // before Vite's CSS step collects the font files
      transform(code, id) {
        if (!/katex.*\.css$/.test(id)) return null;
        return code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)) },
    },
  },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
});
