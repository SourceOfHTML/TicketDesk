export interface ApiErrorEnvelope {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorEnvelope };

/** Inside the rewrite proxy's own 30-second cap. */
const ABORT_AFTER_MS = 15_000;

/** Pages where a signed-out visitor is expected, so a 401 is not news. */
const PUBLIC_PATHS = ['/login', '/signup'];

function isEnvelope(value: unknown): value is ApiErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { statusCode?: unknown }).statusCode === 'number'
  );
}

async function errorEnvelope(response: Response): Promise<ApiErrorEnvelope> {
  try {
    const body: unknown = await response.json();
    if (isEnvelope(body)) {
      return body;
    }
  } catch {
    // A dead API through the rewrite resolves as a 500 with no content-type and
    // an unparseable body. That is the normal shape of this failure, not an
    // edge case, so it must not throw while reporting an error.
  }

  return { statusCode: response.status, message: 'Something went wrong.' };
}

/**
 * Transport only: status, JSON, a 15-second abort. It never navigates, so the
 * public auth endpoints can use it without a 401 causing a redirect. A request
 * that never gets a response is handed to the renderer as a synthesised 503 —
 * there is no separate "unreachable" state.
 */
export async function transport<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ABORT_AFTER_MS);

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
    });

    if (!response.ok) {
      return { ok: false, error: await errorEnvelope(response) };
    }

    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, error: { statusCode: 500, message: 'Something went wrong.' } };
    }
  } catch {
    return {
      ok: false,
      error: { statusCode: 503, message: 'Service Unavailable', error: 'Service Unavailable' },
    };
  } finally {
    clearTimeout(timeout);
  }
}

// A page's own fetch and the layout's `/me` can both 401 in the same tick; the
// first navigation wins.
let redirectingToLogin = false;

function redirectToLoginOnce(): void {
  if (redirectingToLogin) {
    return;
  }

  redirectingToLogin = true;
  window.location.assign('/login?expired=1');
}

/**
 * Every session-scoped call. A 401 means the session ended, so the browser is
 * sent to sign in again — exactly once — except on the public pages, where a
 * 401 from `/me` is simply "signed out" and must not loop.
 */
export async function sessionRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const result = await transport<T>(path, init);

  if (
    !result.ok &&
    result.error.statusCode === 401 &&
    !PUBLIC_PATHS.includes(window.location.pathname)
  ) {
    redirectToLoginOnce();
  }

  return result;
}
