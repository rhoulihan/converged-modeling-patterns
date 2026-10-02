import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // app/public is served by Express, not Vite; without this, Vite refuses the aliased import
  // once the image has built public/vendor/cm.js.
  publicDir: false,
  resolve: {
    // The editor bundle is built at image time; jsdom tests use an in-memory stand-in.
    alias: { '/vendor/cm.js': fileURLToPath(new URL('./test/stubs/cm.js', import.meta.url)) },
  },
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 120000,
    fileParallelism: false, // integration tests share one database
  },
});
