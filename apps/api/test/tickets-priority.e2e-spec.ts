import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createActor, type Actor } from './actors';
import { createTestApp, resetDb } from './app';
import { sessionTokenOf, setCookies } from './cookies';
import { createTicket } from './tickets';

describe('PATCH /api/tickets/:id/priority', () => {
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

  it('changes the Priority and returns the Ticket as the list would', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, {
      creatorId: requester.user.id,
      priority: 'low',
    });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/priority`)
      .send({ priority: 'high' })
      .expect(200);

    expect(response.body).toEqual({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      priority: 'high',
      status: 'open',
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: expect.any(String),
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: null,
    });

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.priority).toBe('high');
  });

  it('shows the new Priority on the refetched list', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id, priority: 'low' });

    await staff.agent
      .patch(`/api/tickets/${ticket.id}/priority`)
      .send({ priority: 'medium' })
      .expect(200);

    const list = await staff.agent.get('/api/tickets').expect(200);

    expect(list.body).toEqual([expect.objectContaining({ id: ticket.id, priority: 'medium' })]);
  });

  it('refuses an unknown Priority with the validation envelope, changing nothing', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id, priority: 'low' });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/priority`)
      .send({ priority: 'urgent' })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: [expect.stringMatching(/^priority: /)],
      error: 'Bad Request',
    });

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.priority).toBe('low');
  });

  it('rejects an unknown key rather than stripping it', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/priority`)
      .send({ priority: 'high', extra: true })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    expect(response.body.message).toContain('Unrecognized key: "extra"');
  });

  it('answers 404 for a nonexistent Ticket', async () => {
    const staff = await createActor(app, 'STAFF');

    const response = await staff.agent
      .patch('/api/tickets/does-not-exist/priority')
      .send({ priority: 'high' })
      .expect(404);

    expect(response.body).toEqual({
      statusCode: 404,
      message: 'Ticket not found',
      error: 'Not Found',
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
      const ticket = await createTicket(app, { creatorId: requester.user.id, priority: 'low' });
      path = `/api/tickets/${ticket.id}/priority`;
    });

    it('anonymous: 401', async () => {
      await request(app.getHttpServer()).patch(path).send({ priority: 'high' }).expect(401);
    });

    it('the Requester who raised it: 403, Priority unchanged', async () => {
      await requester.agent.patch(path).send({ priority: 'high' }).expect(403);

      const stored = await prisma.ticket.findFirst();

      expect(stored?.priority).toBe('low');
    });

    it('another Requester: 403', async () => {
      await otherRequester.agent.patch(path).send({ priority: 'high' }).expect(403);
    });

    it('Staff: 200', async () => {
      const response = await staff.agent.patch(path).send({ priority: 'high' }).expect(200);

      expect(response.body.priority).toBe('high');
    });

    it('refreshes the session cookie, same token, on a 403 and a 200', async () => {
      const requesterToken = sessionTokenOf(setCookies(requester.loginResponse)[0] ?? '');
      const staffToken = sessionTokenOf(setCookies(staff.loginResponse)[0] ?? '');

      const forbidden = await requester.agent.patch(path).send({ priority: 'high' }).expect(403);
      const forbiddenCookies = setCookies(forbidden);

      expect(forbiddenCookies).toHaveLength(1);
      expect(sessionTokenOf(forbiddenCookies[0] ?? '')).toBe(requesterToken);
      expect(forbiddenCookies[0]).toMatch(/Max-Age=604800/);

      const allowed = await staff.agent.patch(path).send({ priority: 'high' }).expect(200);
      const allowedCookies = setCookies(allowed);

      expect(allowedCookies).toHaveLength(1);
      expect(sessionTokenOf(allowedCookies[0] ?? '')).toBe(staffToken);
      expect(allowedCookies[0]).toMatch(/Max-Age=604800/);
    });
  });
});
