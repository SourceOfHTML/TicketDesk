import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createActor } from './actors';
import { createTestApp, resetDb } from './app';

/** A valid body; each test names only the field it is about. */
const TICKET_BODY = {
  title: 'Printer on fire',
  description: 'It is genuinely alight.',
  priority: 'medium',
} as const;

describe('POST /api/tickets', () => {
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

  it('creates an open Ticket raised by the caller and returns it', async () => {
    const requester = await createActor(app);

    const response = await requester.agent
      .post('/api/tickets')
      .send({ ...TICKET_BODY, priority: 'high' })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      title: TICKET_BODY.title,
      description: TICKET_BODY.description,
      priority: 'high',
      status: 'open',
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: null,
    });
    expect(response.text).not.toContain('passwordHash');

    const stored = await prisma.ticket.findUnique({ where: { id: response.body.id } });

    expect(stored).toMatchObject({
      title: TICKET_BODY.title,
      creatorId: requester.user.id,
      status: 'open',
      assigneeId: null,
    });
  });

  it('opens the new Ticket with no Comments and no Status Changes', async () => {
    const requester = await createActor(app);

    const created = await requester.agent.post('/api/tickets').send(TICKET_BODY).expect(201);

    const detail = await requester.agent.get(`/api/tickets/${created.body.id}`).expect(200);

    expect(detail.body).toMatchObject({ status: 'open', comments: [], statusChanges: [] });
  });

  describe('by actor', () => {
    it('anonymous: 401', async () => {
      await request(app.getHttpServer()).post('/api/tickets').send(TICKET_BODY).expect(401);
    });

    it("a Requester: 201, recorded as the new Ticket's Requester", async () => {
      const requester = await createActor(app);

      const response = await requester.agent.post('/api/tickets').send(TICKET_BODY).expect(201);

      expect(response.body.creator).toEqual({
        id: requester.user.id,
        email: requester.user.email,
      });
    });

    it("Staff: 201, recorded as the new Ticket's Requester", async () => {
      const staff = await createActor(app, 'STAFF');

      const response = await staff.agent.post('/api/tickets').send(TICKET_BODY).expect(201);

      expect(response.body.creator).toEqual({ id: staff.user.id, email: staff.user.email });
    });
  });

  it('rejects a body the schema forbids with a field-prefixed 400', async () => {
    const requester = await createActor(app);

    for (const [what, body, prefix] of [
      ['a title over 120 characters', { ...TICKET_BODY, title: 'x'.repeat(121) }, 'title: '],
      ['an empty title', { ...TICKET_BODY, title: '' }, 'title: '],
      [
        'a description over 10,000 characters',
        { ...TICKET_BODY, description: 'x'.repeat(10_001) },
        'description: ',
      ],
      ['an empty description', { ...TICKET_BODY, description: '' }, 'description: '],
      ['an unknown Priority', { ...TICKET_BODY, priority: 'urgent' }, 'priority: '],
    ] as const) {
      const response = await requester.agent.post('/api/tickets').send(body).expect(400);

      expect(response.body, what).toEqual({
        statusCode: 400,
        message: [expect.stringMatching(new RegExp(`^${prefix}`))],
        error: 'Bad Request',
      });
    }
  });

  it('rejects a missing title and a missing description', async () => {
    const requester = await createActor(app);

    const missingTitle = await requester.agent
      .post('/api/tickets')
      .send({ description: TICKET_BODY.description, priority: TICKET_BODY.priority })
      .expect(400);
    expect(missingTitle.body.message).toEqual([expect.stringMatching(/^title: /)]);

    const missingDescription = await requester.agent
      .post('/api/tickets')
      .send({ title: TICKET_BODY.title, priority: TICKET_BODY.priority })
      .expect(400);
    expect(missingDescription.body.message).toEqual([expect.stringMatching(/^description: /)]);
  });

  it('rejects unknown keys, so a caller cannot choose Status, creator or Assignee', async () => {
    const requester = await createActor(app);
    const response = await requester.agent
      .post('/api/tickets')
      .send({ ...TICKET_BODY, status: 'closed' })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: ['Unrecognized key: "status"'],
      error: 'Bad Request',
    });
  });
});
