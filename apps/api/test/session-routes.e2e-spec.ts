import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { ACTOR_PASSWORD, createActor } from './actors';
import { createTestApp, resetDb } from './app';
import { setCookies } from './cookies';

/**
 * The route × actor matrix for the session routes. A public route stays public
 * for a signed-in caller; everything else refuses an anonymous one.
 */
describe('the session routes, by actor', () => {
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

  it('GET /api/auth/me: anonymous 401, signed in 200', async () => {
    const actor = await createActor(app);

    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await actor.agent.get('/api/auth/me').expect(200);
  });

  it('POST /api/auth/login: anonymous 200, signed in 200', async () => {
    const actor = await createActor(app);
    const credentials = { email: actor.user.email, password: ACTOR_PASSWORD };

    await request(app.getHttpServer()).post('/api/auth/login').send(credentials).expect(200);
    await actor.agent.post('/api/auth/login').send(credentials).expect(200);

    // Signing in again starts a second session; it does not replace the first.
    expect(await prisma.session.count()).toBe(3);
  });

  it('POST /api/auth/signup: anonymous 201, signed in 201', async () => {
    const actor = await createActor(app);

    const anonymous = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email: 'anonymous@example.com', password: 'correct horse' })
      .expect(201);
    const signedIn = await actor.agent
      .post('/api/auth/signup')
      .send({ email: 'signed-in@example.com', password: 'correct horse' })
      .expect(201);

    // Public either way, and neither signup starts a session: the actor's
    // own login row is still the only one, and its cookie still works.
    expect(setCookies(anonymous)).toEqual([]);
    expect(setCookies(signedIn)).toEqual([]);
    expect(await prisma.session.count()).toBe(1);
    await actor.agent.get('/api/auth/me').expect(200);
  });

  it('POST /api/auth/logout: anonymous 401, signed in 200', async () => {
    const actor = await createActor(app);

    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    await actor.agent.post('/api/auth/logout').expect(200);
  });
});
