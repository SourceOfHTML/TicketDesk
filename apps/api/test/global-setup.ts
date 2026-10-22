import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client';
import { findRepoRoot } from '../src/repo-root';
import { assertInsideTestRoot } from './isolation';

const REPO_ROOT = findRepoRoot();

let tempRoot: string | undefined;

/**
 * Build the migrated template database once for the whole run. Each test file
 * copies it; nothing here is shared between files.
 */
export async function setup(): Promise<void> {
  tempRoot = mkdtempSync(join(tmpdir(), 'ticketdesk-e2e-'));
  const templatePath = join(tempRoot, 'template.db');
  assertInsideTestRoot(templatePath, tempRoot);

  const databaseUrl = `file:${templatePath}`;
  process.env.TICKETDESK_TEST_ROOT = tempRoot;
  process.env.TICKETDESK_TEST_TEMPLATE = templatePath;
  process.env.DATABASE_URL = databaseUrl;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });

  try {
    // A plain file copy is safe only while SQLite is not in WAL mode: in WAL, the
    // schema can live entirely in the -wal sidecar and the copy would be empty.
    const rows =
      await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode');
    const journalMode = rows[0]?.journal_mode;

    if (journalMode !== 'delete') {
      throw new Error(
        `Expected PRAGMA journal_mode to be "delete" before copying the test template, got "${String(journalMode)}"`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

export async function teardown(): Promise<void> {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
}
