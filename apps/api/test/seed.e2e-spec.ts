import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { findRepoRoot } from '../src/repo-root';
import { createTestPrisma } from './prisma';

let prisma: PrismaClient;

function runSeed(): void {
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'seed'], {
    cwd: findRepoRoot(),
    env: {
      ...process.env,
      STAFF_EMAIL: 'Staff@TicketDesk.local',
      STAFF_PASSWORD: 'seed-password',
    },
    stdio: 'pipe',
  });
}

describe('the seed script', () => {
  beforeAll(() => {
    // After the per-file database has been copied and DATABASE_URL points at it.
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Two Prisma CLI spawns plus argon2id, against every other file in parallel:
  // slower than the suite's own timeout assumes, and slower still on CI.
  it(
    'creates the Staff account and can run again without duplicating it',
    { timeout: 60_000 },
    async () => {
      runSeed();

      const first = await prisma.user.findMany({ where: { role: 'STAFF' } });
      expect(first).toHaveLength(1);
      expect(first[0]?.email).toBe('staff@ticketdesk.local');
      expect(first[0]?.passwordHash.startsWith('$argon2id$')).toBe(true);

      runSeed();

      const second = await prisma.user.findMany({ where: { role: 'STAFF' } });
      expect(second).toHaveLength(1);
      expect(second[0]?.id).toBe(first[0]?.id);
    },
  );
});
