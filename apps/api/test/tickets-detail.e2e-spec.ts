import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createActor } from './actors';
import { createTestApp, resetDb } from './app';
import { createComment, createStatusChange, createTicket } from './tickets';

describe('GET /api/tickets/:id', () => {
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

  it('returns the Ticket with its creator and assignee, and empty blocks', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, {
      creatorId: requester.user.id,
      assigneeId: staff.user.id,
      title: 'Printer on fire',
      description: 'It is genuinely alight.',
      priority: 'high',
      status: 'in-progress',
    });

    const response = await requester.agent.get(`/api/tickets/${ticket.id}`).expect(200);

    expect(response.body).toMatchObject({
      id: ticket.id,
      title: 'Printer on fire',
      description: 'It is genuinely alight.',
      priority: 'high',
      status: 'in-progress',
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: { id: staff.user.id, email: staff.user.email },
      comments: [],
      statusChanges: [],
    });
    expect(response.text).not.toContain('passwordHash');
  });

  it('returns Comments and Status Changes ascending, each with its author or changer', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: requester.user.id });

    // Written newest first so a correct answer can only come from the ordering.
    await createComment(app, {
      ticketId: ticket.id,
      authorId: staff.user.id,
      body: 'Second',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await createComment(app, {
      ticketId: ticket.id,
      authorId: requester.user.id,
      body: 'First',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createStatusChange(app, {
      ticketId: ticket.id,
      changedById: staff.user.id,
      fromStatus: 'in-progress',
      toStatus: 'resolved',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    await createStatusChange(app, {
      ticketId: ticket.id,
      changedById: staff.user.id,
      fromStatus: 'open',
      toStatus: 'in-progress',
      reason: 'Looking into it.',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const response = await requester.agent.get(`/api/tickets/${ticket.id}`).expect(200);

    expect(response.body.comments.map((comment: { body: string }) => comment.body)).toEqual([
      'First',
      'Second',
    ]);
    expect(response.body.comments[0]).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      author: { id: requester.user.id, email: requester.user.email },
    });
    expect(
      response.body.statusChanges.map((change: { fromStatus: string }) => change.fromStatus),
    ).toEqual(['open', 'in-progress']);
    expect(response.body.statusChanges[0]).toMatchObject({
      fromStatus: 'open',
      toStatus: 'in-progress',
      reason: 'Looking into it.',
      createdAt: '2026-03-01T00:00:00.000Z',
      changedBy: { id: staff.user.id, email: staff.user.email },
    });
    expect(response.body.statusChanges[1].reason).toBeNull();

    // Summaries are `{ id, email }`; no password material rides along.
    expect(Object.keys(response.body.comments[0].author).sort()).toEqual(['email', 'id']);
    expect(Object.keys(response.body.statusChanges[0].changedBy).sort()).toEqual(['email', 'id']);
    expect(response.text).not.toContain('passwordHash');
  });

  it('answers by actor: anonymous 401, owner 200, other Requester 403, Staff 200', async () => {
    const owner = await createActor(app);
    const otherRequester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const ticket = await createTicket(app, { creatorId: owner.user.id });
    const path = `/api/tickets/${ticket.id}`;

    await request(app.getHttpServer()).get(path).expect(401);
    await owner.agent.get(path).expect(200);
    // Missing authorization is a 403, never a 404: the Ticket exists.
    await otherRequester.agent.get(path).expect(403);
    await staff.agent.get(path).expect(200);
  });

  it('answers 404, never 400, for a nonexistent or malformed id', async () => {
    const requester = await createActor(app);

    for (const id of ['does-not-exist', 'banana']) {
      const response = await requester.agent.get(`/api/tickets/${id}`).expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        message: 'Ticket not found',
        error: 'Not Found',
      });
    }
  });
});
