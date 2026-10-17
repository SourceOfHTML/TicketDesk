# What the Next.js rewrite does when the API is down

Measured 2026-10-17 on Next.js **16.4.2** (Turbopack), Node **24.13.0**, React 19.3.1.

`apps/web` reaches `apps/api` only through the `next.config` rewrite from ADR-0001, so the
browser never talks to the API directly. This document records what that rewrite does when
the upstream is not answering — the facts behind *Decide: the dev-run workflow* (#18) and the
refinement it forces on *Decide: how apps/web shows a validation failure* (#17).

## The headline

**A browser-side `fetch()` through the rewrite does not reject when the API is down. It
resolves, with a 500.** There is no transport-level failure for the client to detect.

The ticket that raised this question assumed "`fetch` fails outright rather than returning
401". That is true only when the *Next* server is unreachable — at which point there is no
page left to render an error in. For every failure of the API itself, the client gets an
ordinary resolved `Response`.

## Measurements

| Scenario | Status | `content-type` | Body |
|---|---|---|---|
| dev, upstream down (`ECONNREFUSED`) | **500** | **absent** | `Internal Server Error` (21 bytes, plain text) |
| prod (`next build && next start`), upstream down | **500** | **absent** | byte-identical to dev |
| dev, upstream accepts but never responds | **500 after 30.0 s** | absent | `Internal Server Error` |
| upstream 200 + JSON | 200 | `application/json` | passed through |
| upstream 500 + JSON | 500 | `application/json; charset=utf-8` | passed through **byte-identical** |
| upstream 418 / 404 | 418 / 404 | `application/json` | passed through |
| upstream 500, no `content-type` | 500 | absent | passed through |
| upstream 500, `text/html` | 500 | `text/html` | passed through (the upstream's HTML) |

Upstream response headers pass through too. A non-2xx is not intercepted: the proxy relays
whatever the upstream said.

## What the client actually sees

Verified with headless Chromium against a real production build.

- **Upstream down:** `fetch('/api/tickets')` **resolves**. `status` is `500`, `ok` is `false`,
  `type` is `"basic"`, `contentType` is `null`, body is `"Internal Server Error"`. A subsequent
  `res.json()` **throws** `SyntaxError: Unexpected token 'I', "Internal S"... is not valid JSON`.
- **Upstream up, returning a Nest-style 500:** also a resolved `Response` with `status` `500`,
  but `contentType` is `"application/json; charset=utf-8"` and `res.json()` resolves.
- `fetch` rejects **only** if the browser cannot reach the Next server on `:3000` itself.

So **status and `ok` are identical** between "the API crashed" and "the API is not running".
The only observable differences are whether `content-type` is present and whether the body
parses as JSON.

## Consequences for `apps/web`

1. **The error path must tolerate a non-JSON body.** An unparseable body is the *normal*
   shape of this failure, not an edge case. A wrapper that assumes the API's error envelope
   will throw while trying to report an error.
2. **A dead API is indistinguishable from a broken one by status alone**, so #17's rule —
   render keyed off `statusCode`, never off `message` — puts both in the same 5xx bucket.
   #18 decided not to separate them; the distinction would have to come from `content-type`
   or a failed parse, and both are undocumented proxy behaviour.
3. **A request that never returns has no `statusCode` at all.** The 15 s abort #18 settled on
   fires before the proxy's own 30 s cap, so the wrapper synthesises an envelope for the
   renderer rather than inventing a second one.
4. **A hung upstream costs 30 seconds.** `proxyTimeout` defaults to `30_000` and cannot be
   disabled through config; it is settable only as `experimental.proxyTimeout`.

## Where the behaviour comes from

`node_modules/next/dist/server/lib/router-utils/proxy-request.js`: `onProxyError` sets
`res.statusCode = 500` and `res.end('Internal Server Error')` with no `content-type`, guarded
by a `finished` flag so a second error writes no body. The timeout is `proxyTimeout || 30_000`
read from `experimental` (`config-schema.js`).

The stack trace (`Failed to proxy … AggregateError`, `ECONNREFUSED` on both `::1` and
`127.0.0.1` — dual-stack, not a retry) goes to **server stdout only**. Nothing leaks to the
client, and no retry is attempted: the failure is immediate, 3.5 ms.

## Caveats

- **Undocumented.** The official rewrites documentation says nothing about proxy failure, and
  there is no public `proxyTimeout` page. Everything above comes from shipped source and
  measurement, and could change without notice in a Next release — the same exposure
  *Research: does the Next.js rewrites proxy forward Set-Cookie?* (#12) carries, and the same
  remedy applies.
- **Dev and prod are identical**, so this is not a dev-server artefact.
- Measured against a rewrite to a bare `node:http` server, not to NestJS. The upstream's own
  responses were Nest-shaped (JSON error envelope) but not produced by Nest.

## Method

A scratch App Router app with `rewrites()` mapping `/api/:path*` to `http://localhost:3999/api/:path*`,
with nothing listening; and a second scratch upstream returning controlled responses. Probed
with `curl -i` in dev and in a production build, and with headless Chromium for the
client-observable behaviour. Both scratch trees lived outside this repository.
