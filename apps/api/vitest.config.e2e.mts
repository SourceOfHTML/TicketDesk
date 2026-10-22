import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Explicit: Vitest's default include silently skips `*.e2e-spec.ts` and exits 0.
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-database.ts'],
    fileParallelism: true,
    // Files run in parallel; spawning the Prisma CLI twice (the seed test) and
    // argon2id hashing are both CPU-hungry, so Vitest's 5 s default races a
    // loaded machine rather than a slow product.
    testTimeout: 20_000,
  },
  resolve: {
    // Vitest does not read tsconfig `paths`; this is the one alias the tests need.
    alias: {
      '@ticketdesk/shared': resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
