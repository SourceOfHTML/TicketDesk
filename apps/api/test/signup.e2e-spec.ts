import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb } from './app';
import { sessionTokenOf, setCookies } from './cookies';

describe('POST /api/auth/signup', () => {
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

  it('creates a USER and returns its summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'Requester@Example.com', password: 'correct horse' })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      email: 'requester@example.com',
      role: 'USER',
    });

    const stored = await prisma.user.findUnique({
      where: { email: 'requester@example.com' },
    });

    expect(stored).not.toBeNull();
    expect(stored?.email).toBe('requester@example.com');
    expect(stored?.role).toBe('USER');
    expect(stored?.passwordHash).not.toBe('correct horse');
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('starts a session, returning a cookie that reads the new account', async () => {
    const agent = request.agent(app.getHttpServer());

    const response = await agent
      .post('/api/auth/signup')
      .send({ email: 'requester@example.com', password: 'correct horse' })
      .expect(201);

    const cookie = setCookies(response)[0];
    expect(cookie).toMatch(/^session=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800$/);

    const session = await prisma.session.findUnique({
      where: { id: sessionTokenOf(cookie ?? '') },
    });

    expect(session?.userId).toBe(response.body.id);
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 60 * 60 * 1000);

    // The cookie is the session, not a placeholder: it authenticates already.
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body).toEqual(response.body);
  });

  it('rejects a duplicate email with a field-prefixed 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'requester@example.com', password: 'correct horse' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'requester@example.com', password: 'another horse' })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: expect.stringMatching(/^email: /),
      error: 'Bad Request',
    });

    // A refused signup starts nothing: the first account's session stands alone.
    expect(setCookies(response)).toEqual([]);
    expect(await prisma.session.count()).toBe(1);
  });

  it('returns exactly the validation envelope for an invalid body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
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

  it('rejects unknown keys', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'requester@example.com', password: 'correct horse', role: 'STAFF' })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: ['Unrecognized key: "role"'],
      error: 'Bad Request',
    });
  });
});
