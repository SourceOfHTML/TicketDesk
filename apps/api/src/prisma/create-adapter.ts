import { isAbsolute, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { findRepoRoot } from '../repo-root';

/**
 * SQLite paths in `.env` are written relative to the repository root (for example
 * `file:./dev.db`), because that is where the file lives and where the Prisma CLI
 * runs. The adapter resolves paths against the process's working directory
 * instead, which differs when pnpm runs the API from `apps/api`. Resolve them
 * here so the app and the CLI always open the same file.
 */
export function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith('file:')) {
    return url;
  }

  const filePath = url.slice('file:'.length);
  if (filePath === ':memory:' || isAbsolute(filePath)) {
    return url;
  }

  return `file:${resolve(findRepoRoot(), filePath)}`;
}

export function createAdapter(): PrismaBetterSqlite3 {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `pnpm bootstrap` from the repository root to create .env.',
    );
  }

  return new PrismaBetterSqlite3({ url: resolveDatabaseUrl(url) });
}
