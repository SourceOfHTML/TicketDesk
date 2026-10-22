import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDb } from './app';

function setCookies(response: request.Response): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) {
    return [];
  }
  return Array.isArray(header) ? header : [header];
}

function tokenOf(cookie: string): string {
  return /^session=([^;]+)/.exec(cookie)?.[1] ?? '';
}

describe('the session guard', () => {
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

  async function signIn(): Promise<{ cookie: string; userId: string }> {
    const passwordHash = await hashPassword('correct horse');
    const user = await prisma.user.create({
      data: { email: 'requester@example.com', passwordHash, role: 'USER' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'requester@example.com', password: 'correct horse' })
      .expect(200);

    return { cookie: setCookies(login)[0] ?? '', userId: user.id };
  }

  it('answers GET /api/auth/me with the caller and slides the session', async () => {
    const { cookie, userId } = await signIn();
    const token = tokenOf(cookie);

    // An hour old proves the refresh moves the row, rather than reading back
    // what login already wrote.
    await prisma.session.update({
      where: { id: token },
      data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(me.body).toEqual({
      id: userId,
      email: 'requester@example.com',
      role: 'USER',
    });

    const refreshed = setCookies(me);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toContain(`session=${token};`);
    expect(refreshed[0]).toContain('Max-Age=604800');

    const session = await prisma.session.findUnique({ where: { id: token } });
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 60 * 60 * 1000);
  });

  it('refuses an absent cookie with 401 and clears it', async () => {
    const response = await request(app.getHttpServer()).get('/api/auth/me').expect(401);

    expect(response.body).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    });
    expect(setCookies(response)).toEqual(['session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax']);
  });

  it('refuses an unknown token with 401 and clears it', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'session=not-a-real-token')
      .expect(401);

    expect(setCookies(response)).toEqual(['session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax']);
    expect(await prisma.session.count()).toBe(0);
  });

  it('deletes the session on logout and clears the cookie last', async () => {
    const { cookie } = await signIn();
    const token = tokenOf(cookie);

    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(200);

    expect(await prisma.session.findUnique({ where: { id: token } })).toBeNull();

    // The guard refreshed the cookie first; the clear must ride last, or a
    // deliberate sign-out would read as an expired one.
    const sessionCookies = setCookies(response).filter((value) => value.startsWith('session='));
    expect(sessionCookies).toHaveLength(2);
    expect(sessionCookies[0]).toContain(`session=${token};`);
    expect(sessionCookies.at(-1)).toBe('session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
  });

  it('refuses an expired token, clears it, and leaves the row in place', async () => {
    const { cookie } = await signIn();
    const token = tokenOf(cookie);
    const expiredAt = new Date(Date.now() - 1000);
    await prisma.session.update({ where: { id: token }, data: { expiresAt: expiredAt } });

    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(401);

    expect(setCookies(response)).toEqual(['session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax']);

    // Expiry never deletes: the row is inert, not swept (ADR-0002).
    const session = await prisma.session.findUnique({ where: { id: token } });
    expect(session?.expiresAt.getTime()).toBe(expiredAt.getTime());
  });
});
