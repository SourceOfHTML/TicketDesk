import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'session';

/** Seven days, in both units the cookie and the row use. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_LIFETIME_MS = SESSION_MAX_AGE_SECONDS * 1000;

/**
 * The Session row's primary key is the token, so it is generated here and never
 * derived from anything sequential.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_LIFETIME_MS);
}

/**
 * No `Domain`: the Next rewrite forwards a mismatched one unmodified and the
 * browser silently drops the cookie (ADR-0002, docs/research/next-rewrite-cookies.md).
 * `Secure` only outside local development, where the apps speak plain HTTP.
 */
export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

/** The only place a Cookie header is turned into a token. */
export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) {
    return null;
  }

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const name = pair.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      return pair.slice(separator + 1).trim();
    }
  }

  return null;
}
