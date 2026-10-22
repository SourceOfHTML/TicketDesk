import { resolve, sep } from 'node:path';

/**
 * Refuse any database path that is not strictly inside the run's temp root. This
 * is the one guard that keeps a test from reaching the development database.
 */
export function assertInsideTestRoot(path: string, root: string): void {
  const resolvedRoot = resolve(root);
  const insideRoot = resolve(path).startsWith(`${resolvedRoot}${sep}`);

  if (!insideRoot || !resolvedRoot.includes('ticketdesk-e2e-')) {
    throw new Error(`Test database ${path} is not inside the run's temporary directory ${root}`);
  }
}
