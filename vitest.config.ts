import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // Mirrors the `@/*` path alias in tsconfig.json. Type-only imports are
      // erased at compile time, but a runtime import needs this to resolve.
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      // `server-only` throws on import outside a React Server Component, which
      // makes a route handler and its auth guard untestable. Aliased to a no-op
      // for tests only; production resolution is untouched and the guard under
      // test is the real one. Exact-match, because a bare string key is
      // prefix-matched and loses to the package's own exports conditions.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./test-support/server-only.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
