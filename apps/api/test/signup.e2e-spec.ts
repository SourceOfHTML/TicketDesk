import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb } from './app';

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

  it('does not start a session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'requester@example.com', password: 'correct horse' })
      .expect(201);

    expect(response.headers['set-cookie']).toBeUndefined();
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
