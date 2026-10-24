import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createActor, type Actor } from './actors';
import { createTestApp, resetDb } from './app';
import { sessionTokenOf, setCookies } from './cookies';
import { createTicket } from './tickets';

describe('PATCH /api/tickets/:id/assign', () => {
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

  it('assigns any Staff member and returns the Ticket as the list would', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/assign`)
      .send({ assigneeId: staff.user.id })
      .expect(200);

    expect(response.body).toEqual({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      priority: 'medium',
      status: 'open',
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: expect.any(String),
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: { id: staff.user.id, email: staff.user.email },
    });

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.assigneeId).toBe(staff.user.id);
  });

  it('shows the new Assignee on the refetched list', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    await staff.agent
      .patch(`/api/tickets/${ticket.id}/assign`)
      .send({ assigneeId: staff.user.id })
      .expect(200);

    const list = await staff.agent.get('/api/tickets').expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({
        id: ticket.id,
        assignee: { id: staff.user.id, email: staff.user.email },
      }),
    ]);
  });

  it('unassigns with null', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, {
      creatorId: requester.user.id,
      assigneeId: staff.user.id,
    });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/assign`)
      .send({ assigneeId: null })
      .expect(200);

    expect(response.body.assignee).toBeNull();

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.assigneeId).toBeNull();
  });

  it('refuses a User whose Role is not STAFF with 400, changing nothing', async () => {
    const requester = await createActor(app);
    const otherRequester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, {
      creatorId: requester.user.id,
      assigneeId: staff.user.id,
    });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/assign`)
      .send({ assigneeId: otherRequester.user.id })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: expect.any(String),
      error: 'Bad Request',
    });

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.assigneeId).toBe(staff.user.id);
  });

  it('refuses an Assignee that names no User with 400', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    await staff.agent
      .patch(`/api/tickets/${ticket.id}/assign`)
      .send({ assigneeId: 'does-not-exist' })
      .expect(400);

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.assigneeId).toBeNull();
  });

  it('rejects a missing or malformed assigneeId with the validation envelope', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    for (const body of [{}, { assigneeId: '' }, { assigneeId: 42 }]) {
      const response = await staff.agent
        .patch(`/api/tickets/${ticket.id}/assign`)
        .send(body)
        .expect(400);

      expect(response.body).toEqual({
        statusCode: 400,
        message: [expect.stringMatching(/^assigneeId: /)],
        error: 'Bad Request',
      });
    }
  });

  it('answers 404 for a nonexistent Ticket', async () => {
    const staff = await createActor(app, 'STAFF');

    const response = await staff.agent
      .patch('/api/tickets/does-not-exist/assign')
      .send({ assigneeId: null })
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
    let assignee: Actor;
    let path: string;
    let ticketId: string;

    beforeEach(async () => {
      requester = await createActor(app);
      otherRequester = await createActor(app);
      staff = await createActor(app, 'STAFF');
      assignee = await createActor(app, 'STAFF');
      const ticket = await createTicket(app, { creatorId: requester.user.id });
      ticketId = ticket.id;
      path = `/api/tickets/${ticket.id}/assign`;
    });

    it('anonymous: 401', async () => {
      await request(app.getHttpServer())
        .patch(path)
        .send({ assigneeId: assignee.user.id })
        .expect(401);
    });

    it('the Requester who raised it: 403, Assignee unchanged', async () => {
      await requester.agent.patch(path).send({ assigneeId: assignee.user.id }).expect(403);

      const stored = await prisma.ticket.findUnique({ where: { id: ticketId } });

      expect(stored?.assigneeId).toBeNull();
    });

    it('another Requester: 403', async () => {
      await otherRequester.agent.patch(path).send({ assigneeId: assignee.user.id }).expect(403);
    });

    it('Staff: 200', async () => {
      const response = await staff.agent
        .patch(path)
        .send({ assigneeId: assignee.user.id })
        .expect(200);

      expect(response.body.assignee).toEqual({
        id: assignee.user.id,
        email: assignee.user.email,
      });
    });

    it('refreshes the session cookie, same token, on a 403 and a 200', async () => {
      const requesterToken = sessionTokenOf(setCookies(requester.loginResponse)[0] ?? '');
      const staffToken = sessionTokenOf(setCookies(staff.loginResponse)[0] ?? '');

      const forbidden = await requester.agent
        .patch(path)
        .send({ assigneeId: assignee.user.id })
        .expect(403);
      const forbiddenCookies = setCookies(forbidden);

      expect(forbiddenCookies).toHaveLength(1);
      expect(sessionTokenOf(forbiddenCookies[0] ?? '')).toBe(requesterToken);
      expect(forbiddenCookies[0]).toMatch(/Max-Age=604800/);

      const allowed = await staff.agent
        .patch(path)
        .send({ assigneeId: assignee.user.id })
        .expect(200);
      const allowedCookies = setCookies(allowed);

      expect(allowedCookies).toHaveLength(1);
      expect(sessionTokenOf(allowedCookies[0] ?? '')).toBe(staffToken);
      expect(allowedCookies[0]).toMatch(/Max-Age=604800/);
    });
  });
});
