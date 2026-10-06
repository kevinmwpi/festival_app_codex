import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));
const resolve = (path: string) => join(root, path);

/**
 * Unit tests for the app's plain logic (release guards, location sharing controller, labels). Native
 * modules and workspace packages with native dependencies are replaced with `vi.mock` in each test;
 * `@festival/domain` (pure TypeScript) runs from source.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@festival/domain', replacement: resolve('../../packages/domain/src/index.ts') },
      // The app's `@/…` import alias (tsconfig `paths`).
      { find: /^@\//, replacement: `${root}/` },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
