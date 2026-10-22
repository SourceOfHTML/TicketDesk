import { NextResponse, type NextRequest } from 'next/server';

/** Allowed through in code, not in the matcher: the gate is absence, not path. */
const PUBLIC_PATHS = new Set(['/login', '/signup']);

/**
 * A navigation redirect, not a security boundary: the API is the only boundary
 * (ADR-0001). It reads the cookie's presence and never its validity —
 * resolving the session is the API's job — and it must not answer an API 401
 * with an HTML redirect, which is why `api` is excluded by the matcher.
 *
 * There is deliberately no inverse redirect for a signed-in visitor: a cookie
 * that has outlived its Session row would loop forever.
 */
export function proxy(request: NextRequest): NextResponse {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (!request.cookies.has('session')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
