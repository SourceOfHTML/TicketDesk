import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The workspace root, found by walking up from the working directory. The API is
 * started from `apps/api` by pnpm but from the root by the Prisma CLI, so neither
 * `__dirname` nor `process.cwd()` is reliable on its own in every context.
 */
export function findRepoRoot(start = process.cwd()): string {
  let directory = start;

  for (;;) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not find the repository root above ${start}`);
    }

    directory = parent;
  }
}
