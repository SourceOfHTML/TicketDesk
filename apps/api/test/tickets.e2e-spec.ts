import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createActor } from './actors';
import { createTestApp, resetDb } from './app';
import { createTicket } from './tickets';

describe('GET /api/tickets', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it("lists the caller's Tickets, newest first, with creator and assignee summaries", async () => {
    const requester = await createActor(app);
    const otherRequester = await createActor(app);
    const staff = await createActor(app, 'STAFF');

    const older = await createTicket(app, {
      creatorId: requester.user.id,
      title: 'Older',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newer = await createTicket(app, {
      creatorId: requester.user.id,
      assigneeId: staff.user.id,
      title: 'Newer',
      priority: 'high',
      status: 'in-progress',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await createTicket(app, {
      creatorId: otherRequester.user.id,
      title: 'Not mine',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const response = await requester.agent.get('/api/tickets').expect(200);

    expect(response.body.map((ticket: { title: string }) => ticket.title)).toEqual([
      'Newer',
      'Older',
    ]);
    expect(response.body[0]).toMatchObject({
      id: newer.id,
      title: 'Newer',
      priority: 'high',
      status: 'in-progress',
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: { id: staff.user.id, email: staff.user.email },
    });
    expect(response.body[1]).toMatchObject({
      id: older.id,
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: null,
    });

    // User summaries are `{ id, email }`; no password material rides along.
    expect(Object.keys(response.body[0].creator).sort()).toEqual(['email', 'id']);
    expect(Object.keys(response.body[0].assignee).sort()).toEqual(['email', 'id']);
    expect(response.text).not.toContain('passwordHash');
  });

  it('filters by any of several Statuses', async () => {
    const requester = await createActor(app);
    const otherRequester = await createActor(app);

    await createTicket(app, { creatorId: requester.user.id, title: 'Open', status: 'open' });
    await createTicket(app, {
      creatorId: requester.user.id,
      title: 'In progress',
      status: 'in-progress',
    });
    await createTicket(app, {
      creatorId: requester.user.id,
      title: 'Resolved',
      status: 'resolved',
    });
    await createTicket(app, { creatorId: requester.user.id, title: 'Closed', status: 'closed' });
    await createTicket(app, {
      creatorId: otherRequester.user.id,
      title: 'Other open',
      status: 'open',
    });

    const response = await requester.agent.get('/api/tickets?status=open,closed').expect(200);

    expect(response.body.map((ticket: { title: string }) => ticket.title).sort()).toEqual([
      'Closed',
      'Open',
    ]);
  });

  it('filters by any of several Priorities and combines Status with Priority', async () => {
    const requester = await createActor(app);

    await createTicket(app, {
      creatorId: requester.user.id,
      title: 'Open high',
      status: 'open',
      priority: 'high',
    });
    await createTicket(app, {
      creatorId: requester.user.id,
      title: 'Open low',
      status: 'open',
      priority: 'low',
    });
    await createTicket(app, {
      creatorId: requester.user.id,
      title: 'Open medium',
      status: 'open',
      priority: 'medium',
    });
    await createTicket(app, {
      creatorId: requester.user.id,
      title: 'Closed high',
      status: 'closed',
      priority: 'high',
    });

    const byPriority = await requester.agent.get('/api/tickets?priority=high,low').expect(200);
    expect(byPriority.body.map((ticket: { title: string }) => ticket.title).sort()).toEqual([
      'Closed high',
      'Open high',
      'Open low',
    ]);

    const combined = await requester.agent
      .get('/api/tickets?status=open&priority=high,low')
      .expect(200);
    expect(combined.body.map((ticket: { title: string }) => ticket.title).sort()).toEqual([
      'Open high',
      'Open low',
    ]);
  });

  it('refuses anonymous callers and scopes each Requester to their own Tickets', async () => {
    const owner = await createActor(app);
    const otherRequester = await createActor(app);
    await createActor(app, 'STAFF');

    const ownTicket = await createTicket(app, { creatorId: owner.user.id });
    const othersTicket = await createTicket(app, { creatorId: otherRequester.user.id });

    await request(app.getHttpServer()).get('/api/tickets').expect(401);

    const own = await owner.agent.get('/api/tickets').expect(200);
    expect(own.body.map((ticket: { id: string }) => ticket.id)).toEqual([ownTicket.id]);

    const other = await otherRequester.agent.get('/api/tickets').expect(200);
    expect(other.body.map((ticket: { id: string }) => ticket.id)).toEqual([othersTicket.id]);
  });

  it('shows Staff every Ticket', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');

    const first = await createTicket(app, { creatorId: requester.user.id });
    const second = await createTicket(app, { creatorId: staff.user.id });

    const response = await staff.agent.get('/api/tickets').expect(200);

    expect(response.body.map((ticket: { id: string }) => ticket.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('rejects malformed filter values with the validation envelope', async () => {
    const requester = await createActor(app);

    for (const [query, prefix] of [
      ['status=banana', 'status: '],
      ['status=open,banana', 'status: '],
      ['status=', 'status: '],
      ['priority=urgent', 'priority: '],
      ['sort=oldest', 'Unrecognized key: '],
    ] as const) {
      const response = await requester.agent.get(`/api/tickets?${query}`).expect(400);

      expect(response.body).toEqual({
        statusCode: 400,
        message: [expect.stringMatching(new RegExp(`^${prefix}`))],
        error: 'Bad Request',
      });
    }
  });
});
