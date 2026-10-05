import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Test against workspace sources so module mocks apply inside them.
      '@festival/sync-engine': resolve('../sync-engine/src/index.ts'),
      '@festival/domain': resolve('../domain/src/index.ts'),
      // Native modules replaced by in-memory fakes.
      'react-native-mmkv': resolve('./test/mocks/react-native-mmkv.ts'),
      '@react-native-community/netinfo': resolve('./test/mocks/netinfo.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // EXPO_PUBLIC_SUPABASE_* are deliberately unset: tests inject a fake client.
    env: {
      EXPO_PUBLIC_SUPABASE_URL: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
      EXPO_PUBLIC_SUPABASE_KEY: '',
    },
  },
});
