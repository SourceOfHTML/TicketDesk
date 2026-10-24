import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createActor, type Actor } from './actors';
import { createTestApp, resetDb } from './app';
import { createTicket } from './tickets';

describe('POST /api/tickets/:id/comments', () => {
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

  it("appends a Comment by the Ticket's Requester and returns it with its author", async () => {
    const requester = await createActor(app);
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    const response = await requester.agent
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'Any news?' })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      body: 'Any news?',
      createdAt: expect.any(String),
      author: { id: requester.user.id, email: requester.user.email },
    });
    expect(response.text).not.toContain('passwordHash');

    const stored = await prisma.comment.findUnique({ where: { id: response.body.id } });

    expect(stored).toMatchObject({
      ticketId: ticket.id,
      authorId: requester.user.id,
      body: 'Any news?',
    });
  });

  describe('by actor', () => {
    let requester: Actor;
    let otherRequester: Actor;
    let staff: Actor;
    let path: string;

    beforeEach(async () => {
      requester = await createActor(app);
      otherRequester = await createActor(app);
      staff = await createActor(app, 'STAFF');
      const ticket = await createTicket(app, { creatorId: requester.user.id });
      path = `/api/tickets/${ticket.id}/comments`;
    });

    it('anonymous: 401', async () => {
      await request(app.getHttpServer()).post(path).send({ body: 'Hello?' }).expect(401);
    });

    it('the Requester who raised it: 201', async () => {
      await requester.agent.post(path).send({ body: 'Hello?' }).expect(201);
    });

    it('another Requester: 403, and no Comment is written', async () => {
      await otherRequester.agent.post(path).send({ body: 'Hello?' }).expect(403);

      expect(await prisma.comment.count()).toBe(0);
    });

    it('Staff: 201', async () => {
      const response = await staff.agent.post(path).send({ body: 'On it.' }).expect(201);

      expect(response.body.author).toEqual({ id: staff.user.id, email: staff.user.email });
    });
  });

  describe('by Status', () => {
    it('refuses a Comment on a closed Ticket with 403, and writes nothing', async () => {
      const requester = await createActor(app);
      const ticket = await createTicket(app, {
        creatorId: requester.user.id,
        status: 'closed',
      });

      const response = await requester.agent
        .post(`/api/tickets/${ticket.id}/comments`)
        .send({ body: 'One more thing.' })
        .expect(403);

      expect(response.body).toEqual({
        statusCode: 403,
        message: expect.any(String),
        error: 'Forbidden',
      });
      expect(await prisma.comment.count()).toBe(0);
    });

    it('accepts a Comment on a resolved Ticket', async () => {
      const requester = await createActor(app);
      const ticket = await createTicket(app, {
        creatorId: requester.user.id,
        status: 'resolved',
      });

      await requester.agent
        .post(`/api/tickets/${ticket.id}/comments`)
        .send({ body: 'It came back.' })
        .expect(201);
    });
  });

  it('rejects a body the schema forbids with a field-prefixed 400, writing nothing', async () => {
    const requester = await createActor(app);
    const ticket = await createTicket(app, { creatorId: requester.user.id });
    const path = `/api/tickets/${ticket.id}/comments`;

    for (const [what, body, prefix] of [
      ['a body over 10,000 characters', { body: 'x'.repeat(10_001) }, 'body: '],
      ['an empty body', { body: '' }, 'body: '],
      ['a missing body', {}, 'body: '],
      ['an unknown key', { body: 'Hello?', authorId: 'someone-else' }, 'Unrecognized key'],
    ] as const) {
      const response = await requester.agent.post(path).send(body).expect(400);

      expect(response.body, what).toEqual({
        statusCode: 400,
        message: [expect.stringMatching(new RegExp(`^${prefix}`))],
        error: 'Bad Request',
      });
    }

    expect(await prisma.comment.count()).toBe(0);
  });

  it('answers 404, never 400, for a nonexistent ticket id', async () => {
    const requester = await createActor(app);

    for (const id of ['does-not-exist', 'banana']) {
      const response = await requester.agent
        .post(`/api/tickets/${id}/comments`)
        .send({ body: 'Hello?' })
        .expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        message: 'Ticket not found',
        error: 'Not Found',
      });
    }
  });

  it('appends to the Ticket thread, readable through the detail route', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    await requester.agent
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'Any news?' })
      .expect(201);
    await staff.agent
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'On it.' })
      .expect(201);

    const detail = await requester.agent.get(`/api/tickets/${ticket.id}`).expect(200);

    // Two posts can share a millisecond, so their relative order is not this
    // test's to assert; the ascending contract is covered with fixed times in
    // the detail spec. What matters here is that both landed with their authors.
    expect(detail.body.comments).toHaveLength(2);
    expect(detail.body.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: 'Any news?',
          author: { id: requester.user.id, email: requester.user.email },
        }),
        expect.objectContaining({
          body: 'On it.',
          author: { id: staff.user.id, email: staff.user.email },
        }),
      ]),
    );
  });

  it('offers no edit or delete route for a Comment', async () => {
    const requester = await createActor(app);
    const ticket = await createTicket(app, { creatorId: requester.user.id });
    const posted = await requester.agent
      .post(`/api/tickets/${ticket.id}/comments`)
      .send({ body: 'Written once.' })
      .expect(201);
    const commentPath = `/api/tickets/${ticket.id}/comments/${posted.body.id}`;

    await requester.agent.patch(commentPath).send({ body: 'Edited.' }).expect(404);
    await requester.agent.delete(commentPath).expect(404);

    const [stored] = await prisma.comment.findMany();

    expect(stored.body).toBe('Written once.');
  });
});
