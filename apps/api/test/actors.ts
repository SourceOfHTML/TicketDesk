import type { INestApplication } from '@nestjs/common';
import type { Role } from '@ticketdesk/shared';
import request from 'supertest';
import type { UserModel } from '../src/generated/prisma/models';
import { hashPassword } from '../src/auth/password';
import { PrismaService } from '../src/prisma/prisma.service';

export const ACTOR_PASSWORD = 'actor-password';

let counter = 0;

// Vitest gives each test file its own module registry, so this is one hash per
// file (ADR-0002's argon2id is deliberately slow) without sharing across files.
let hash: Promise<string> | undefined;
function actorHash(): Promise<string> {
  hash ??= hashPassword(ACTOR_PASSWORD);
  return hash;
}

export interface Actor {
  user: UserModel;
  agent: ReturnType<typeof request.agent>;
  login: request.Response;
}

/**
 * Writes the User row directly, then signs in through the real login route on a
 * fresh agent. The login response is returned so a caller can inspect its
 * cookie; ticket-shaped fixtures stay direct Prisma writes.
 */
export async function createActor(app: INestApplication, role: Role = 'USER'): Promise<Actor> {
  const email = `${role.toLowerCase()}-${++counter}@example.com`;
  const user = await app
    .get(PrismaService)
    .user.create({ data: { email, passwordHash: await actorHash(), role } });

  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/api/auth/login')
    .send({ email, password: ACTOR_PASSWORD })
    .expect(200);

  return { user, agent, login };
}
