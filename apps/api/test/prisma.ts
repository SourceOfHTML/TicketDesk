import { PrismaClient } from '../src/generated/prisma/client';
import { createAdapter } from '../src/prisma/create-adapter';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: createAdapter() });
}
