import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { userSummarySchema, type UserSummary } from '@ticketdesk/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Prove against the real built apps that the session cookie survives the Next
 * rewrite and slides correctly — the one undocumented behaviour the auth
 * design rests on. See issue #41 and docs/research/next-rewrite-cookies.md.
 *
 * Three failure classes, because a red here is otherwise easy to misattribute:
 * SETUP could not reach the starting line, PRECONDITION the API's own login is
 * broken, SUBJECT the rewrite is not forwarding `Set-Cookie`. Only the last
 * may name the proxy.
 */
type Verdict = 'SETUP' | 'PRECONDITION' | 'SUBJECT';

const VERDICT_LINES: Record<Verdict, string> = {
  SETUP: 'the smoke job could not reach its own starting line — this is not a proxy regression',
  PRECONDITION: "the API's own login route is broken — this is not the proxy",
  SUBJECT:
    'the rewrite proxy stopped forwarding Set-Cookie — see docs/research/next-rewrite-cookies.md',
};

const ROOT = process.cwd();
const API_DIR = resolve(ROOT, 'apps/api');
const WEB_DIR = resolve(ROOT, 'apps/web');
const NEXT_BIN = join(WEB_DIR, 'node_modules/next/dist/bin/next');

const API_PORT = 3001;
const WEB_PORT = 3000;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;
const STOP_GRACE_MS = 5_000;
const CURL_TIMEOUT_SECONDS = 30;

class SmokeFailure extends Error {
  constructor(
    readonly verdict: Verdict,
    message: string,
  ) {
    super(message);
  }
}

interface HttpResponse {
  label: string;
  status: number;
  setCookies: string[];
  body: string;
  raw: string;
}

/** Every raw response seen, so a failure can print the bytes it judged. */
const transcripts: Array<{ label: string; raw: string }> = [];

async function main(): Promise<void> {
  const runDir = mkdtempSync(join(tmpdir(), 'ticketdesk-smoke-cookie-'));
  const databaseUrl = `file:${join(runDir, 'smoke.db')}`;
  const jar = join(runDir, 'cookies.txt');
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  let api: ChildProcess | undefined;
  let web: ChildProcess | undefined;

  try {
    console.log(`smoke:cookie: throwaway database ${databaseUrl}`);

    // Readiness counts any answer as up, so a dev server already on the port
    // would answer for a child that never started and turn this green.
    await ensurePortFree(API_PORT);
    await ensurePortFree(WEB_PORT);

    prepare(env);

    api = spawnApi(env);
    await waitForServer('the API', API_PORT, api);
    web = spawnWeb(env);
    await waitForServer('web', WEB_PORT, web);

    // Signup is direct on :3001 so a failure there can never be read as a
    // proxy failure. The proxy is then exercised only by login and replay.
    const credentials = {
      email: `smoke-${randomUUID()}@example.com`,
      password: 'smoke-cookie-password',
    };
    const body = JSON.stringify(credentials);

    const signup = request(
      'POST :3001/api/auth/signup (direct)',
      'SETUP',
      postJson(`${API}/api/auth/signup`, body),
    );
    expectStatus(signup, 201, 'PRECONDITION');
    const caller = parseSummary(signup, 'PRECONDITION');

    const control = request(
      'POST :3001/api/auth/login (control, direct)',
      'SETUP',
      postJson(`${API}/api/auth/login`, body),
    );
    expectStatus(control, 200, 'PRECONDITION');
    const controlCookie = sessionCookieOf(control, 'PRECONDITION');
    const controlTail = attributesOf(controlCookie, 'PRECONDITION', control.label);

    ensureAlive(api, 'the API');
    ensureAlive(web, 'web');
    const subject = request(
      'POST :3000/api/auth/login (subject, through the rewrite)',
      'SUBJECT',
      postJson(`${WEB}/api/auth/login`, body, ['--cookie-jar', jar]),
    );
    expectStatus(subject, 200, 'SUBJECT');
    const subjectCookie = sessionCookieOf(subject, 'SUBJECT');
    const subjectTail = attributesOf(subjectCookie, 'SUBJECT', subject.label);

    if (controlTail !== subjectTail) {
      throw new SmokeFailure(
        'SUBJECT',
        `the cookie attributes differ across the rewrite\n  direct:  ${controlTail}\n  through: ${subjectTail}`,
      );
    }

    ensureAlive(api, 'the API');
    ensureAlive(web, 'web');
    const replay = request('GET :3000/api/auth/me (replay, through the rewrite)', 'SUBJECT', [
      '--cookie',
      jar,
      '--cookie-jar',
      jar,
      `${WEB}/api/auth/me`,
    ]);
    expectStatus(replay, 200, 'SUBJECT');
    const replayed = parseSummary(replay, 'SUBJECT');

    if (
      replayed.id !== caller.id ||
      replayed.email !== caller.email ||
      replayed.role !== caller.role
    ) {
      throw new SmokeFailure(
        'SUBJECT',
        `the replay was answered as a different user: ${JSON.stringify(replayed)}`,
      );
    }

    const refreshed = sessionCookieOf(replay, 'SUBJECT');
    if (tokenOf(refreshed) !== tokenOf(subjectCookie)) {
      throw new SmokeFailure(
        'SUBJECT',
        `the replay refreshed the session with a different token\n  login:   ${tokenOf(subjectCookie)}\n  refresh: ${tokenOf(refreshed)}`,
      );
    }

    const refreshedTail = attributesOf(refreshed, 'SUBJECT', replay.label);
    if (refreshedTail !== controlTail) {
      throw new SmokeFailure(
        'SUBJECT',
        `the re-issued cookie's attributes changed\n  direct:  ${controlTail}\n  through: ${refreshedTail}`,
      );
    }

    console.log(
      '\nsmoke:cookie passed: the session cookie survives the rewrite and is refreshed on replay.',
    );
  } finally {
    await stop(web);
    await stop(api);
    rmSync(runDir, { recursive: true, force: true });
  }
}

function prepare(env: NodeJS.ProcessEnv): void {
  console.log('smoke:cookie: preparing and seeding the database (pnpm bootstrap)');
  run('pnpm bootstrap', 'pnpm', ['run', 'bootstrap'], env, ROOT);

  console.log('smoke:cookie: building the web app');
  run('the web build', process.execPath, [NEXT_BIN, 'build'], env, WEB_DIR);
}

function spawnApi(env: NodeJS.ProcessEnv): ChildProcess {
  // SWC, not tsx: Nest needs `design:paramtypes`, which tsx's esbuild does not emit (README).
  return spawn(process.execPath, ['--require', '@swc-node/register', 'src/main.ts'], {
    cwd: API_DIR,
    env,
    stdio: 'inherit',
  });
}

function spawnWeb(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [NEXT_BIN, 'start', '--port', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env,
    stdio: 'inherit',
  });
}

function run(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): void {
  try {
    execFileSync(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  } catch (error) {
    throw new SmokeFailure('SETUP', `${label} failed: ${describe(error)}`);
  }
}

/** Binding is the same test the server will face, and leaves nothing behind. */
async function ensurePortFree(port: number): Promise<void> {
  await new Promise<void>((resolveFree, reject) => {
    const probe = createServer();

    probe.once('listening', () => probe.close(() => resolveFree()));
    probe.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new SmokeFailure(
              'SETUP',
              `port :${port} is already in use — the smoke job needs it to itself`,
            )
          : new SmokeFailure('SETUP', `could not probe port :${port}: ${describe(error)}`),
      );
    });

    probe.listen(port);
  });
}

/** Any status code counts as up: `/api/auth/me` correctly answers 401 with no session. */
async function waitForServer(name: string, port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (hasExited(child)) {
      throw new SmokeFailure('SETUP', `${name} exited before answering on :${port}`);
    }

    if (await answers(port)) {
      return;
    }

    await sleep(READY_POLL_MS);
  }

  throw new SmokeFailure(
    'SETUP',
    `${name} did not answer on :${port} within ${READY_TIMEOUT_MS / 1000} seconds`,
  );
}

async function answers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(1_000),
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || hasExited(child)) {
    return;
  }

  child.kill('SIGTERM');
  if (await waitForExit(child, STOP_GRACE_MS)) {
    return;
  }

  child.kill('SIGKILL');
  await waitForExit(child, STOP_GRACE_MS);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolveExit(false);
    }, timeoutMs);

    const onExit = (): void => {
      clearTimeout(timer);
      resolveExit(true);
    };

    child.once('exit', onExit);
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Checks the process is still alive so a dead server is never blamed on the proxy. */
function ensureAlive(child: ChildProcess, name: string): void {
  if (hasExited(child)) {
    throw new SmokeFailure('SETUP', `${name} exited before the smoke job finished`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** `--dump-header -` is the exact wire view the research measured. */
function curl(label: string, args: string[]): HttpResponse {
  const raw = execFileSync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--max-time',
      String(CURL_TIMEOUT_SECONDS),
      '--dump-header',
      '-',
      ...args,
    ],
    { encoding: 'utf8' },
  );

  return parseResponse(label, raw);
}

/** One request, recorded verbatim so a failure can print the bytes it judged. */
function request(label: string, verdict: Verdict, args: string[]): HttpResponse {
  let response: HttpResponse;

  try {
    response = curl(label, args);
  } catch (error) {
    throw new SmokeFailure(verdict, `${label} did not complete: ${describe(error)}`);
  }

  transcripts.push({ label, raw: response.raw });
  return response;
}

function postJson(url: string, body: string, extra: string[] = []): string[] {
  return [
    '--request',
    'POST',
    '--header',
    'content-type: application/json',
    '--data-binary',
    body,
    ...extra,
    url,
  ];
}

function parseResponse(label: string, raw: string): HttpResponse {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const head = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const body = headerEnd === -1 ? '' : raw.slice(headerEnd + 4);
  const [statusLine = '', ...headerLines] = head.split('\r\n');
  const status = Number(/^HTTP\/\S+\s+(\d{3})/.exec(statusLine)?.[1] ?? Number.NaN);

  if (Number.isNaN(status)) {
    throw new Error(`Could not parse curl's status line: ${JSON.stringify(statusLine)}`);
  }

  const setCookies: string[] = [];
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    if (line.slice(0, separator).trim().toLowerCase() === 'set-cookie') {
      setCookies.push(line.slice(separator + 1).trim());
    }
  }

  return { label, status, setCookies, body, raw };
}

function expectStatus(response: HttpResponse, expected: number, verdict: Verdict): void {
  if (response.status !== expected) {
    throw new SmokeFailure(
      verdict,
      `${response.label} answered ${response.status}, expected ${expected}: ${response.body.trim()}`,
    );
  }
}

function sessionCookieOf(response: HttpResponse, verdict: Verdict): string {
  // The literal `session` name is the browser's contract here, so it is stated
  // rather than imported from the API's constant.
  const cookies = response.setCookies.filter((cookie) => cookie.startsWith('session='));

  if (cookies.length !== 1) {
    throw new SmokeFailure(
      verdict,
      `${response.label} carried ${cookies.length} session Set-Cookie headers, expected exactly one`,
    );
  }

  return cookies[0]!;
}

/** Everything after the first `;`: the attributes, which must survive the hop unchanged. */
function attributesOf(cookie: string, verdict: Verdict, what: string): string {
  const semicolon = cookie.indexOf(';');

  if (semicolon === -1) {
    throw new SmokeFailure(verdict, `${what} set a session cookie with no attributes: ${cookie}`);
  }

  return cookie.slice(semicolon);
}

function tokenOf(cookie: string): string {
  return /^session=([^;]*)/.exec(cookie)?.[1] ?? '';
}

function parseSummary(response: HttpResponse, verdict: Verdict): UserSummary {
  try {
    return userSummarySchema.parse(JSON.parse(response.body));
  } catch (error) {
    throw new SmokeFailure(
      verdict,
      `${response.label} returned an unreadable user summary: ${describe(error)}`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  const failure =
    error instanceof SmokeFailure
      ? error
      : new SmokeFailure('SETUP', `the smoke job crashed: ${describe(error)}`);

  console.error(`${failure.verdict}: ${VERDICT_LINES[failure.verdict]}`);
  console.error(`  ${failure.message}`);

  for (const { label, raw } of transcripts) {
    console.error(`\n--- ${label} ---\n${raw.trimEnd()}`);
  }

  process.exitCode = 1;
});
