import type { INestApplication } from '@nestjs/common';
import type { Status } from '@ticketdesk/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createActor, type Actor } from './actors';
import { createTestApp, resetDb } from './app';
import { sessionTokenOf, setCookies } from './cookies';
import { createTicket } from './tickets';

const STATUSES = ['open', 'in-progress', 'resolved', 'closed'] as const;

/** The spec's table, not the implementation's: everything else is a 400. */
function isLegal(from: Status, to: Status): boolean {
  return [
    ['open', 'in-progress'],
    ['in-progress', 'open'],
    ['in-progress', 'resolved'],
    ['resolved', 'in-progress'],
    ['resolved', 'closed'],
    ['closed', 'open'],
  ].some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to);
}

/** A re-open is the one move whose request carries a reason by default. */
function moveBody(from: Status, to: Status): { status: Status; reason?: string } {
  return from === 'closed' && to === 'open'
    ? { status: to, reason: 'Back again.' }
    : { status: to };
}

describe('PATCH /api/tickets/:id/status', () => {
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

  it('moves the Ticket and appends a Status Change by the mover', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    const response = await staff.agent
      .patch(`/api/tickets/${ticket.id}/status`)
      .send({ status: 'in-progress' })
      .expect(200);

    expect(response.body).toEqual({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      priority: 'medium',
      status: 'in-progress',
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: expect.any(String),
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: null,
    });

    const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

    expect(stored?.status).toBe('in-progress');

    const changes = await prisma.statusChange.findMany({ where: { ticketId: ticket.id } });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      fromStatus: 'open',
      toStatus: 'in-progress',
      changedById: staff.user.id,
      reason: null,
    });
  });

  it('allows exactly the six legal moves and refuses every other pair with 400', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');

    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const ticket = await createTicket(app, { creatorId: requester.user.id, status: from });
        const response = await staff.agent
          .patch(`/api/tickets/${ticket.id}/status`)
          .send(moveBody(from, to));

        if (isLegal(from, to)) {
          expect(response.status, `${from} → ${to}`).toBe(200);
          expect(response.body.status).toBe(to);

          const changes = await prisma.statusChange.findMany({ where: { ticketId: ticket.id } });

          expect(changes, `${from} → ${to}`).toHaveLength(1);
          expect(changes[0]).toMatchObject({ fromStatus: from, toStatus: to });
        } else {
          expect(response.status, `${from} → ${to}`).toBe(400);
          expect(response.body).toEqual({
            statusCode: 400,
            message: `Cannot move a ticket from ${from} to ${to}.`,
            error: 'Bad Request',
          });

          const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

          expect(stored?.status, `${from} → ${to}`).toBe(from);
          expect(
            await prisma.statusChange.count({ where: { ticketId: ticket.id } }),
            `${from} → ${to}`,
          ).toBe(0);
        }
      }
    }
  });

  it('records a reason given on any other legal move, trimmed', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    await staff.agent
      .patch(`/api/tickets/${ticket.id}/status`)
      .send({ status: 'in-progress', reason: '  Picking this up.  ' })
      .expect(200);

    const [change] = await prisma.statusChange.findMany({ where: { ticketId: ticket.id } });

    expect(change.reason).toBe('Picking this up.');
  });

  describe('re-opening a closed Ticket', () => {
    it('records the reason and shows it in the history with the mover', async () => {
      const requester = await createActor(app);
      const staff = await createActor(app, 'STAFF');
      const ticket = await createTicket(app, {
        creatorId: requester.user.id,
        status: 'closed',
      });

      const response = await staff.agent
        .patch(`/api/tickets/${ticket.id}/status`)
        .send({ status: 'open', reason: '  Customer replied.  ' })
        .expect(200);

      expect(response.body.status).toBe('open');

      const detail = await requester.agent.get(`/api/tickets/${ticket.id}`).expect(200);

      expect(detail.body.statusChanges).toEqual([
        {
          id: expect.any(String),
          fromStatus: 'closed',
          toStatus: 'open',
          reason: 'Customer replied.',
          createdAt: expect.any(String),
          changedBy: { id: staff.user.id, email: staff.user.email },
        },
      ]);
    });

    it('refuses a missing, empty or whitespace-only reason with 400, changing nothing', async () => {
      const requester = await createActor(app);
      const staff = await createActor(app, 'STAFF');
      const ticket = await createTicket(app, {
        creatorId: requester.user.id,
        status: 'closed',
      });

      for (const reason of [undefined, '', '   ']) {
        const response = await staff.agent
          .patch(`/api/tickets/${ticket.id}/status`)
          .send({ status: 'open', ...(reason === undefined ? {} : { reason }) })
          .expect(400);

        expect(response.body).toEqual({
          statusCode: 400,
          message: 'A reason is required to re-open a closed ticket.',
          error: 'Bad Request',
        });
      }

      const stored = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      expect(stored?.status).toBe('closed');
      expect(await prisma.statusChange.count()).toBe(0);
    });

    it('accepts Comments again once the Ticket is open', async () => {
      const requester = await createActor(app);
      const staff = await createActor(app, 'STAFF');
      const ticket = await createTicket(app, {
        creatorId: requester.user.id,
        status: 'closed',
      });
      const commentsPath = `/api/tickets/${ticket.id}/comments`;

      await requester.agent.post(commentsPath).send({ body: 'Hello again?' }).expect(403);
      await staff.agent
        .patch(`/api/tickets/${ticket.id}/status`)
        .send({ status: 'open', reason: 'Customer replied.' })
        .expect(200);
      await requester.agent.post(commentsPath).send({ body: 'Hello again?' }).expect(201);
    });
  });

  it("does not record a Ticket's creation as a Status Change", async () => {
    const requester = await createActor(app);

    const created = await requester.agent
      .post('/api/tickets')
      .send({ title: 'Printer on fire', description: 'Alight.', priority: 'high' })
      .expect(201);

    expect(await prisma.statusChange.count({ where: { ticketId: created.body.id } })).toBe(0);

    const detail = await requester.agent.get(`/api/tickets/${created.body.id}`).expect(200);

    expect(detail.body.status).toBe('open');
    expect(detail.body.statusChanges).toEqual([]);
  });

  it('rejects a missing or unknown status, an unknown key and an over-long reason, writing nothing', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });
    const path = `/api/tickets/${ticket.id}/status`;

    for (const [what, body, pattern] of [
      ['a missing status', {}, /^status: /],
      ['an unknown status', { status: 'reopen' }, /^status: /],
      ['an unknown key', { status: 'open', changedById: 'someone-else' }, /^Unrecognized key/],
      ['an over-long reason', { status: 'open', reason: 'x'.repeat(2_049) }, /^reason: /],
    ] as const) {
      const response = await staff.agent.patch(path).send(body).expect(400);

      expect(response.body, what).toEqual({
        statusCode: 400,
        message: [expect.stringMatching(pattern)],
        error: 'Bad Request',
      });
    }

    expect(await prisma.statusChange.count()).toBe(0);
  });

  it('answers 404 for a nonexistent Ticket', async () => {
    const staff = await createActor(app, 'STAFF');

    const response = await staff.agent
      .patch('/api/tickets/does-not-exist/status')
      .send({ status: 'in-progress' })
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
    let ticketId: string;

    beforeEach(async () => {
      requester = await createActor(app);
      otherRequester = await createActor(app);
      staff = await createActor(app, 'STAFF');
      const ticket = await createTicket(app, { creatorId: requester.user.id });
      ticketId = ticket.id;
      path = `/api/tickets/${ticket.id}/status`;
    });

    it('anonymous: 401', async () => {
      await request(app.getHttpServer()).patch(path).send({ status: 'in-progress' }).expect(401);
    });

    it('the Requester who raised it: 403, Status unchanged', async () => {
      await requester.agent.patch(path).send({ status: 'in-progress' }).expect(403);

      const stored = await prisma.ticket.findUnique({ where: { id: ticketId } });

      expect(stored?.status).toBe('open');
      expect(await prisma.statusChange.count()).toBe(0);
    });

    it('another Requester: 403', async () => {
      await otherRequester.agent.patch(path).send({ status: 'in-progress' }).expect(403);
    });

    it('Staff: 200', async () => {
      const response = await staff.agent.patch(path).send({ status: 'in-progress' }).expect(200);

      expect(response.body.status).toBe('in-progress');
    });

    it('refreshes the session cookie, same token, on a 403 and a 200', async () => {
      const requesterToken = sessionTokenOf(setCookies(requester.loginResponse)[0] ?? '');
      const staffToken = sessionTokenOf(setCookies(staff.loginResponse)[0] ?? '');

      const forbidden = await requester.agent
        .patch(path)
        .send({ status: 'in-progress' })
        .expect(403);
      const forbiddenCookies = setCookies(forbidden);

      expect(forbiddenCookies).toHaveLength(1);
      expect(sessionTokenOf(forbiddenCookies[0] ?? '')).toBe(requesterToken);
      expect(forbiddenCookies[0]).toMatch(/Max-Age=604800/);

      const allowed = await staff.agent.patch(path).send({ status: 'in-progress' }).expect(200);
      const allowedCookies = setCookies(allowed);

      expect(allowedCookies).toHaveLength(1);
      expect(sessionTokenOf(allowedCookies[0] ?? '')).toBe(staffToken);
      expect(allowedCookies[0]).toMatch(/Max-Age=604800/);
    });
  });
});
