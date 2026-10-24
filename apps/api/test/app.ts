import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  configureApp(app);
  await app.init();

  return app;
}

export async function resetDb(app: INestApplication): Promise<void> {
  // Dependency order. Child tables are deleted before the rows they point at,
  // so foreign keys never block the reset.
  await app.get(PrismaService).statusChange.deleteMany();
  await app.get(PrismaService).comment.deleteMany();
  await app.get(PrismaService).session.deleteMany();
  await app.get(PrismaService).ticket.deleteMany();
  await app.get(PrismaService).user.deleteMany();
}
