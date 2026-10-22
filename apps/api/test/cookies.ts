import type request from 'supertest';

/** Every `Set-Cookie` line on a response, whichever shape supertest exposed. */
export function setCookies(response: request.Response): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) {
    return [];
  }
  return Array.isArray(header) ? header : [header];
}

/** The token in a raw `session=...` Set-Cookie value. */
export function sessionTokenOf(cookie: string): string {
  return /^session=([^;]+)/.exec(cookie)?.[1] ?? '';
}
