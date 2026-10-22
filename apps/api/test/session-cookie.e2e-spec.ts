import { Controller, Get, UseGuards, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Roles, RolesGuard } from '../src/auth/roles.guard';
import { SessionGuard } from '../src/auth/session.guard';
import { createActor } from './actors';
import { resetDb } from './app';
import { setCookies } from './cookies';

/** A Staff-only route used only to observe a 403's cookie, until real ones exist. */
@Controller('staff-only')
class StaffOnlyController {
  @Get()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles('STAFF')
  read(): { ok: true } {
    return { ok: true };
  }
}

interface ParsedSetCookie {
  name: string;
  value: string;
  attributes: Map<string, string>;
  flags: Set<string>;
}

/**
 * A hand-rolled `;`-split parser: every assertion about a cookie must be
 * order-insensitive, and the browser's view is the one that matters.
 */
function parseSetCookie(raw: string): ParsedSetCookie {
  const [pair = '', ...tail] = raw.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  const attributes = new Map<string, string>();
  const flags = new Set<string>();

  for (const attribute of tail) {
    const equals = attribute.indexOf('=');
    if (equals === -1) {
      flags.add(attribute.toLowerCase());
    } else {
      attributes.set(attribute.slice(0, equals).toLowerCase(), attribute.slice(equals + 1));
    }
  }

  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    attributes,
    flags,
  };
}

function sessionCookies(response: request.Response): ParsedSetCookie[] {
  return setCookies(response)
    .map(parseSetCookie)
    .filter((cookie) => cookie.name === 'session');
}

function expectSessionAttributes(cookie: ParsedSetCookie, maxAge: number): void {
  expect(cookie.flags.has('httponly')).toBe(true);
  expect(cookie.attributes.get('samesite')?.toLowerCase()).toBe('lax');
  expect(cookie.attributes.get('path')).toBe('/');
  expect(cookie.attributes.get('max-age')).toBe(String(maxAge));
  // A mismatched Domain is forwarded unmodified and silently loses the session.
  expect(cookie.attributes.has('domain')).toBe(false);
}

describe('the session cookie', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [StaffOnlyController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('sets HttpOnly; SameSite=Lax; Path=/; Max-Age=604800 on login', async () => {
    const actor = await createActor(app);

    const cookies = sessionCookies(actor.loginResponse);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.value).not.toBe('');
    expectSessionAttributes(cookies[0]!, 604800);
  });

  it('re-issues the same token with a recomputed Max-Age on an authenticated request', async () => {
    const actor = await createActor(app);
    const token = sessionCookies(actor.loginResponse)[0]?.value;

    const me = await actor.agent.get('/api/auth/me').expect(200);

    const cookies = sessionCookies(me);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.value).toBe(token);
    expectSessionAttributes(cookies[0]!, 604800);
  });

  it('re-issues the same token on a response that ends in 403', async () => {
    const actor = await createActor(app, 'USER');
    const token = sessionCookies(actor.loginResponse)[0]?.value;

    const forbidden = await actor.agent.get('/api/staff-only').expect(403);

    const cookies = sessionCookies(forbidden);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.value).toBe(token);
    expectSessionAttributes(cookies[0]!, 604800);
  });

  it('clears an unknown token with Max-Age=0', async () => {
    const refused = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'session=unknown-token')
      .expect(401);

    const cookies = sessionCookies(refused);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.value).toBe('');
    expectSessionAttributes(cookies[0]!, 0);
  });

  it('sends the logout refresh first and the clear last', async () => {
    const actor = await createActor(app);
    const token = sessionCookies(actor.loginResponse)[0]?.value;

    const logout = await actor.agent.post('/api/auth/logout').expect(200);

    const cookies = sessionCookies(logout);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]?.value).toBe(token);
    expectSessionAttributes(cookies[0]!, 604800);
    expect(cookies[1]?.value).toBe('');
    expectSessionAttributes(cookies[1]!, 0);
  });
});
