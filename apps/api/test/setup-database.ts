import { createHash } from 'node:crypto';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect } from 'vitest';
import { assertInsideTestRoot } from './isolation';

/**
 * Once per test file: copy the migrated template to a file derived from this
 * test file's path and point DATABASE_URL at it. Two files can then run in
 * parallel without seeing each other's rows.
 */
beforeAll(() => {
  const root = process.env.TICKETDESK_TEST_ROOT;
  const template = process.env.TICKETDESK_TEST_TEMPLATE;

  if (!root || !template) {
    throw new Error('Global setup did not provide the test template database');
  }

  // Without it, every file in a worker would copy to the same name.
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error('Could not determine the current test file path');
  }

  const name = createHash('sha256').update(testPath).digest('hex').slice(0, 16);
  const copyPath = join(root, `${name}.db`);

  assertInsideTestRoot(copyPath, root);
  copyFileSync(template, copyPath);
  process.env.DATABASE_URL = `file:${copyPath}`;
});
