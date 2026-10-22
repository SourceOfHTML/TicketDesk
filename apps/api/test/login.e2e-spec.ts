import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb } from './app';
import { sessionTokenOf, setCookies } from './cookies';

describe('POST /api/auth/login', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('returns the user summary and starts a database-backed session', async () => {
    const passwordHash = await hashPassword('correct horse');
    const user = await prisma.user.create({
      data: { email: 'requester@example.com', passwordHash, role: 'USER' },
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'Requester@Example.com', password: 'correct horse' })
      .expect(200);

    expect(response.body).toEqual({
      id: user.id,
      email: 'requester@example.com',
      role: 'USER',
    });

    const cookie = setCookies(response)[0];
    expect(cookie).toMatch(/^session=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800$/);

    const session = await prisma.session.findUnique({
      where: { id: sessionTokenOf(cookie ?? '') },
    });

    expect(session?.userId).toBe(user.id);
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 60 * 60 * 1000);
  });

  it('refuses an unknown email and a wrong password alike, starting no session', async () => {
    const passwordHash = await hashPassword('correct horse');
    await prisma.user.create({
      data: { email: 'requester@example.com', passwordHash, role: 'USER' },
    });

    for (const credentials of [
      { email: 'nobody@example.com', password: 'correct horse' },
      { email: 'requester@example.com', password: 'wrong horse' },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(credentials)
        .expect(401);

      expect(response.body).toEqual({
        statusCode: 401,
        message: 'Invalid email or password',
        error: 'Unauthorized',
      });
      expect(setCookies(response)).toEqual([]);
    }

    expect(await prisma.session.count()).toBe(0);
  });

  it('returns the validation envelope for an invalid body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: [
        'email: Invalid email address',
        'password: Too small: expected string to have >=1 characters',
      ],
      error: 'Bad Request',
    });
  });
});
