import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createActor } from './actors';
import { createTestApp, resetDb } from './app';
import { sessionTokenOf, setCookies } from './cookies';
import { createTicket } from './tickets';

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

describe('GET /api/staff', () => {
  it('returns every Staff member as a summary, and no Requester', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const otherStaff = await createActor(app, 'STAFF');

    const response = await staff.agent.get('/api/staff').expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual(
      expect.arrayContaining([
        { id: staff.user.id, email: staff.user.email },
        { id: otherStaff.user.id, email: otherStaff.user.email },
      ]),
    );
    for (const entry of response.body as object[]) {
      expect(Object.keys(entry).sort()).toEqual(['email', 'id']);
    }
    expect(response.body.map((entry: { id: string }) => entry.id)).not.toContain(requester.user.id);
    expect(response.text).not.toContain('passwordHash');
  });
});

/**
 * The route × actor matrix for the Ticket list, its Assignee filter, and the
 * Staff directory. This is where permissions are tested: the bug it guards
 * against is a route that forgot its guard, so every route is driven by every
 * actor in one place.
 */
describe("the Staff queue's routes, by actor", () => {
  it('GET /api/tickets: anonymous 401, each Requester sees their own, Staff sees every Ticket', async () => {
    const requester = await createActor(app);
    const otherRequester = await createActor(app);
    const staff = await createActor(app, 'STAFF');

    const theirTicket = await createTicket(app, { creatorId: requester.user.id });
    const otherTicket = await createTicket(app, { creatorId: otherRequester.user.id });

    await request(app.getHttpServer()).get('/api/tickets').expect(401);

    const asRequester = await requester.agent.get('/api/tickets').expect(200);
    expect(asRequester.body.map((ticket: { id: string }) => ticket.id)).toEqual([theirTicket.id]);

    const asOtherRequester = await otherRequester.agent.get('/api/tickets').expect(200);
    expect(asOtherRequester.body.map((ticket: { id: string }) => ticket.id)).toEqual([
      otherTicket.id,
    ]);

    const asStaff = await staff.agent.get('/api/tickets').expect(200);
    expect(asStaff.body.map((ticket: { id: string }) => ticket.id).sort()).toEqual(
      [theirTicket.id, otherTicket.id].sort(),
    );
  });

  it('GET /api/tickets?assigneeId=: anonymous 401, a Requester 403, Staff 200 filtered', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');

    const assigned = await createTicket(app, {
      creatorId: requester.user.id,
      assigneeId: staff.user.id,
    });
    await createTicket(app, { creatorId: requester.user.id });

    const path = `/api/tickets?assigneeId=${staff.user.id}`;

    await request(app.getHttpServer()).get(path).expect(401);
    await requester.agent.get(path).expect(403);

    const asStaff = await staff.agent.get(path).expect(200);
    expect(asStaff.body.map((ticket: { id: string }) => ticket.id)).toEqual([assigned.id]);
  });

  it('GET /api/staff: anonymous 401, a Requester 403, Staff 200', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');

    await request(app.getHttpServer()).get('/api/staff').expect(401);
    await requester.agent.get('/api/staff').expect(403);

    const asStaff = await staff.agent.get('/api/staff').expect(200);
    expect(asStaff.body).toEqual(
      expect.arrayContaining([{ id: staff.user.id, email: staff.user.email }]),
    );
  });

  it('refreshes the session cookie, same token, on a 403 from each Staff-only boundary', async () => {
    const requester = await createActor(app);
    const staff = await createActor(app, 'STAFF');
    const token = sessionTokenOf(setCookies(requester.loginResponse)[0] ?? '');

    for (const path of [`/api/tickets?assigneeId=${staff.user.id}`, '/api/staff']) {
      const forbidden = await requester.agent.get(path).expect(403);

      const cookies = setCookies(forbidden);
      expect(cookies).toHaveLength(1);
      expect(sessionTokenOf(cookies[0] ?? '')).toBe(token);
      expect(cookies[0]).toMatch(/Max-Age=604800/);
    }
  });
});
