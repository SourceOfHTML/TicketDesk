import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createActor } from './actors';
import { createTestApp, resetDb } from './app';

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

  it('creates an open Ticket owned by the caller and returns it', async () => {
    const requester = await createActor(app);

    const response = await requester.agent
      .post('/api/tickets')
      .send({
        title: 'Printer on fire',
        description: 'It is genuinely alight.',
        priority: 'high',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      title: 'Printer on fire',
      description: 'It is genuinely alight.',
      priority: 'high',
      status: 'open',
      creator: { id: requester.user.id, email: requester.user.email },
      assignee: null,
    });
    expect(response.text).not.toContain('passwordHash');

    const stored = await prisma.ticket.findUnique({ where: { id: response.body.id } });

    expect(stored).toMatchObject({
      title: 'Printer on fire',
      creatorId: requester.user.id,
      status: 'open',
      assigneeId: null,
    });
  });

  it('opens the new Ticket with no Comments and no Status Changes', async () => {
    const requester = await createActor(app);

    const created = await requester.agent
      .post('/api/tickets')
      .send({ title: 'Printer on fire', description: 'It is genuinely alight.', priority: 'high' })
      .expect(201);

    const detail = await requester.agent.get(`/api/tickets/${created.body.id}`).expect(200);

    expect(detail.body).toMatchObject({ status: 'open', comments: [], statusChanges: [] });
  });

  describe('by actor', () => {
    const body = {
      title: 'Printer on fire',
      description: 'It is genuinely alight.',
      priority: 'medium',
    };

    it('anonymous: 401', async () => {
      await request(app.getHttpServer()).post('/api/tickets').send(body).expect(401);
    });

    it('a Requester: 201, owning the new Ticket', async () => {
      const requester = await createActor(app);

      const response = await requester.agent.post('/api/tickets').send(body).expect(201);

      expect(response.body.creator).toEqual({
        id: requester.user.id,
        email: requester.user.email,
      });
    });

    it('Staff: 201, owning the new Ticket', async () => {
      const staff = await createActor(app, 'STAFF');

      const response = await staff.agent.post('/api/tickets').send(body).expect(201);

      expect(response.body.creator).toEqual({ id: staff.user.id, email: staff.user.email });
    });
  });

  it('rejects a body the schema forbids with a field-prefixed 400', async () => {
    const requester = await createActor(app);
    const valid = {
      title: 'Printer on fire',
      description: 'It is genuinely alight.',
      priority: 'medium',
    } as const;

    for (const [what, body, prefix] of [
      ['a title over 120 characters', { ...valid, title: 'x'.repeat(121) }, 'title: '],
      ['an empty title', { ...valid, title: '' }, 'title: '],
      [
        'a description over 10,000 characters',
        { ...valid, description: 'x'.repeat(10_001) },
        'description: ',
      ],
      ['an empty description', { ...valid, description: '' }, 'description: '],
      ['an unknown Priority', { ...valid, priority: 'urgent' }, 'priority: '],
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
    const valid = {
      title: 'Printer on fire',
      description: 'It is genuinely alight.',
      priority: 'medium',
    } as const;

    const missingTitle = await requester.agent
      .post('/api/tickets')
      .send({ description: valid.description, priority: valid.priority })
      .expect(400);
    expect(missingTitle.body.message).toEqual([expect.stringMatching(/^title: /)]);

    const missingDescription = await requester.agent
      .post('/api/tickets')
      .send({ title: valid.title, priority: valid.priority })
      .expect(400);
    expect(missingDescription.body.message).toEqual([expect.stringMatching(/^description: /)]);
  });

  it('rejects unknown keys, so a caller cannot choose Status, creator or Assignee', async () => {
    const requester = await createActor(app);
    const response = await requester.agent
      .post('/api/tickets')
      .send({
        title: 'Printer on fire',
        description: 'It is genuinely alight.',
        priority: 'medium',
        status: 'closed',
      })
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: ['Unrecognized key: "status"'],
      error: 'Bad Request',
    });
  });
});
