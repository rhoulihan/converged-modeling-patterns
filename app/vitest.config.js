import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
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
