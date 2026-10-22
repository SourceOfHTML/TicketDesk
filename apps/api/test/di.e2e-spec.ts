import type { INestApplication } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

describe('dependency injection metadata', () => {
  it('emits design:paramtypes for a decorated controller', () => {
    const paramtypes = Reflect.getMetadata('design:paramtypes', AuthController) as
      unknown[] | undefined;

    expect(paramtypes).toBeDefined();
    expect(paramtypes?.length).toBeGreaterThan(0);
    expect(paramtypes?.[0]).toBe(AuthService);
  });

  it('boots the real application with its dependencies resolved', async () => {
    let app: INestApplication | undefined;

    try {
      app = await createTestApp();
      const prisma = app.get(PrismaService);
      await prisma.user.count();
      expect(app.get(AuthService)).toBeDefined();
    } finally {
      await app?.close();
    }
  });
});
