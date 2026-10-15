# Does the Next.js `rewrites()` proxy forward `Set-Cookie` to the browser?

**Ticket:** [#12](https://github.com/SourceOfHTML/TicketDesk/issues/12) (wayfinder research)
**Question owner:** TicketDesk architecture (auth design)
**Researched:** 2026-10-10
**Next.js version tested:** 16.4.0 (the `latest` dist-tag on that date; published 2026-10-06)

---

## Verdict

**YES. It works.** A `next.config.ts` `rewrites()` rule with an absolute `destination` forwards the
upstream `Set-Cookie` header — or multiple of them — to the browser **completely unmodified**.

I did not take this from a blog post. I built the exact topology TicketDesk proposes (a cookie-setting
upstream on `:3001`, a Next.js app on `:3000` rewriting `/api/:path*` to it) and measured the bytes on
the wire. Every cookie attribute that matters to this design (`HttpOnly`, `SameSite`, `Path`,
`Max-Age`) survives intact, all three `Set-Cookie` headers arrive as three separate headers, a cookie
value containing a comma is not corrupted, and a browser cookie jar accepts the result and sends it
back on the next request. **The auth design does not need to be redone.**

The rewrite-proxy transport is sound. The report that convinced you otherwise is a **self-retracted**
issue (see §3a), and the famous "Next.js collapses multiple `Set-Cookie` headers" bug lives in a
*different layer* that this design does not touch.

What does need design attention are limitations that are **not** about `Set-Cookie` forwarding: the
proxy does not rewrite the `Location` header, it does not apply to server-side `fetch`; you must not set
an explicit `Domain`; and you must not gate route selection on a cookie-matching rewrite. See
[Limitations](#limitations-and-caveats-that-do-affect-the-design) — five items, all actionable.

### Confidence at a glance

| Finding | Confidence | Basis |
|---|---|---|
| Single `Set-Cookie` forwarded unmodified | **Certain** | Measured on 16.4.0, dev + production |
| Multiple `Set-Cookie` headers preserved separately (not comma-joined) | **Certain** | Measured, 3 headers, all distinct |
| `HttpOnly`, `SameSite`, `Path`, `Max-Age` preserved verbatim | **Certain** | Measured on the wire + cookie jar |
| Comma inside a cookie value not corrupted | **Certain** | Measured (`junk=a,b`) |
| Identical in dev (`next dev`) and production (`next build && next start`) | **Certain** | Measured both |
| Identical for initial load, client-side nav, RSC request, prefetch | **Certain** | Measured all four |
| Different port on same host is irrelevant (host-scoped cookies) | **Certain** | Measured + RFC 6265 §8.5 |
| Browser stores the cookie and replays it to `:3000` | **Certain** | Measured with a cookie jar |
| `Location` header is NOT rewritten | **Certain** | Measured; consistent with source |
| `Domain` attribute passed through unmodified (not rewritten to match) | **Certain** | Measured; confirmed in source |
| Server-side `fetch` bypasses rewrites entirely | **Certain** | Measured (throws on relative URL) |
| RSC-received `Set-Cookie` is not relayed to the browser | **Certain** | Measured — no header on the browser response |
| Official docs say nothing about any of this | **High** | Full docs corpus grepped; 0 hits for `Set-Cookie` in rewrites docs |
| Behaviour is not a 16.4.0 fluke — identical on 15.5.27 | **Certain** | Same harness re-run on the previous major |
| Survives the `http-proxy` → `httpxy` implementation swap | **Certain** | v15.5.27 and v16.4.0 use different proxy libraries |
| No tracker report of a config rewrite dropping `Set-Cookie` | **High** | Issue/PR/discussion survey; search not exhaustive |
| Multiple-`Set-Cookie` collapsing bug is in a *different* layer | **High** | Fix #47718 + code path analysis |

---

## Method

Five independent lines of evidence, in descending order of weight:

1. **Empirical test (primary).** A purpose-built harness on the exact proposed topology, run against
   Next.js 16.4.0 in both dev and production mode, and against 15.5.27 (which uses a *different* proxy
   library). Raw response headers captured with `curl -D -`, browser storage semantics simulated with a
   cookie jar. This is the load-bearing evidence.
2. **Next.js source (mechanism).** The installed `next@16.4.0` package, to explain *why* the observed
   behaviour occurs and to establish that it is structural rather than incidental.
3. **Issue tracker (corroboration + known bugs).** A survey of `vercel/next.js` issues, PRs and
   discussions, separating config-level `rewrites()` from the middleware/`Headers` layer — because that
   conflation is the single biggest trap in this question. See §7.
4. **Official documentation (absence).** The complete Next.js v16 docs corpus
   (`https://nextjs.org/docs/llms-full.txt`, 4.2 MB, self-reporting `@doc-version: >=v16.4.0`),
   grepped directly rather than searched.
5. **RFC 6265 (spec).** To settle the port-scoping question independently of any implementation.

The test harness is reproduced in [Appendix A](#appendix-a-reproducing-the-test) so this result can be
re-run rather than taken on trust.

---

## The test harness

The topology is exactly the one in the ticket:

```ts
// next.config.ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:3001/api/:path*" },
    ];
  },
};
```

A bare Node `http` server on `:3001` sets **three** `Set-Cookie` headers on `/api/login`, chosen to
exercise every failure mode a proxy could plausibly have:

```
Set-Cookie: sid=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600
Set-Cookie: theme=dark; Path=/; SameSite=Strict
Set-Cookie: junk=a,b; Path=/
```

The third is deliberate: a comma inside an unquoted cookie value is exactly what gets corrupted when a
proxy collapses multiple `Set-Cookie` headers into one comma-joined string.

---

## Findings

### 1. Does a `rewrites()` rule return the upstream `Set-Cookie` unmodified? — YES

Through the rewrite on `:3000`, versus the upstream on `:3001` as a control:

```http
=== THROUGH :3000 REWRITE PROXY ===          === DIRECT :3001 UPSTREAM (control) ===
HTTP/1.1 200 OK                              HTTP/1.1 200 OK
set-cookie: sid=abc123; Path=/; HttpOnly; ... set-cookie: sid=abc123; Path=/; HttpOnly; ...
set-cookie: theme=dark; Path=/; SameSite=... set-cookie: theme=dark; Path=/; SameSite=...
set-cookie: junk=a,b; Path=/                 set-cookie: junk=a,b; Path=/
content-type: application/json               content-type: application/json
x-upstream: yes                              x-upstream: yes
Vary: Accept-Encoding
```

Three separate `Set-Cookie` headers survive as three separate headers. The comma-bearing value
`junk=a,b` is intact. A non-cookie custom header (`x-upstream`) also passes through, confirming this is
a general response-header pass-through and not cookie-specific special-casing. Next.js adds only
`Vary: Accept-Encoding`. Payload and status are byte-identical.

**Why this works (mechanism).** In the installed package, external rewrites are dispatched to
`proxyRequest` in `next/dist/server/lib/router-utils/proxy-request.js`. It constructs an `httpxy`
proxy server (in 16.4.0 this is `httpxy`, Next.js's vendored replacement for the older
`http-proxy` — the swap landed in [PR #96060](https://github.com/vercel/next.js/pull/96060), merged
2026-07-27) with:

```js
const proxy = new ProxyServer({
    target,
    changeOrigin: true,
    ignorePath: true,
    ws: true,
    proxyTimeout: /* ... */ 30000,
    headers: { 'x-forwarded-host': req.headers.host || '' }
});
```

Two facts follow, and both are load-bearing:

* **No `selfHandleResponse`.** The upstream response is streamed straight through to the client
  response. Headers are not re-serialised by Next.js, so they cannot be re-serialised incorrectly.
* **No `cookieDomainRewrite`, no `cookiePathRewrite`.** This matters because `httpxy` *does* have a
  cookie-rewriting code path, and it is dormant only because Next.js declines to enable it:

  ```js
  const s = /* cookieDomainRewrite option */;
  const setHeader = function (e, r) {
      if (r === void 0 || !String(e).trim()) return;
      if (s && e.toLowerCase() === "set-cookie") r = rewriteCookieProperty(r, s, "domain");
      if (n && e.toLowerCase() === "set-cookie") r = rewriteCookieProperty(r, n, "path");
      t.setHeader(String(e).trim(), r);
  };
  ```

  I verified programmatically that neither option string appears anywhere in Next.js's
  `proxy-request.js`. **When `cookieDomainRewrite` is unset, `setHeader` writes the upstream
  `Set-Cookie` value through untouched.** This is the code-level reason the measured attributes are
  byte-identical, and confirms that the `Domain` behaviour in §3b below is deliberate-in-effect rather
  than accidental.
* **No response-header filtering at all.** `setHeader` is a pure copy of `proxyRes.headers`; there is
  no allow-list, no `Set-Cookie` special case, and no `resHeaders` overlay. For `set-cookie` the copied
  value is a Node **array**, which emits multiple distinct `Set-Cookie` lines.

This has a direct consequence for the cookie-repair story: because the external-rewrite path returns
`resHeaders: null` from `resolve-routes.ts` and `router-server.ts` guards with
`if (resHeaders !== null)`, **`next.config.js` `headers()` rules are not applied to external rewrites
at all**. You cannot use a `headers()` rule to repair a `Set-Cookie` `Domain` on a rewritten path.
*(Code-verified; no issue reports this. Confidence: medium-high.)*

### 2. Are `HttpOnly`, `SameSite`, `Path`, `Max-Age` preserved? — YES, all of them

Measured verbatim pass-through for every attribute, and confirmed to be *honoured*, not merely
forwarded, by driving a cookie jar through the proxy:

```
=== login through :3000, store cookies in jar ===
localhost	FALSE	/	FALSE	0	junk	a,b
localhost	FALSE	/	FALSE	0	theme	dark
#HttpOnly_localhost	FALSE	/	FALSE	1791641379	sid	abc123
```

* `HttpOnly` — preserved and honoured: the jar records `sid` on a `#HttpOnly_` line.
* `Max-Age=3600` — preserved and honoured: the jar recorded expiry `1791641379`, i.e. 3607 s after the
  request — one hour plus a few seconds of request latency. The `Max-Age` reached the browser and was
  applied, rather than being dropped (in which case the jar would show a session cookie or `Max-Age=0`).
* `Path=/` — preserved.
* `SameSite=Lax` / `SameSite=Strict` — preserved verbatim.

The round trip then completes against the upstream:

```
=== whoami through :3000 (cookie replayed, reaches upstream) ===
{"cookie":"theme=dark; junk=a,b; sid=abc123"}
```

The browser sent its cookies to `:3000`; the proxy forwarded the inbound `Cookie` header; the upstream
saw all three. **Both directions of the cookie flow work through the rewrite.**

This was also run in production mode (`next build && next start`) with identical results, including the
cookie-jar round trip. Dev and production behave the same here.

**Cross-major check, and a cross-implementation one.** The entire harness was re-run against
**Next.js 15.5.27** (the previous major, and the current `backport` dist-tag) in production mode,
pointed at the same `:3001` upstream. Output was identical — three separate `Set-Cookie` headers, all
attributes intact, and a successful cookie-jar round trip
(`{"cookie":"theme=dark; junk=a,b; sid=abc123"}`).

This is a stronger result than it first looks, because **the two versions do not use the same proxy
library.** I checked the compiled dependencies in each install:

| Version | Proxy implementation |
|---|---|
| 15.5.27 | `next/dist/compiled/http-proxy` (the original lineage) |
| 16.4.0 | `next/dist/compiled/httpxy` ([PR #96060](https://github.com/vercel/next.js/pull/96060), merged 2026-07-27) |

So the faithful `Set-Cookie` pass-through **survived a deliberate swap of the entire proxy
implementation.** That is good evidence the behaviour is a property of the design (stream the upstream
response through, never re-serialise it) rather than an incidental quirk of one library — which is the
main risk I would otherwise have been unable to rule out.

One incidental note: the v15 harness required `typescript@^6` and a `.js` config, since TypeScript 7 and
`next.config.ts` in that combination are unsupported on 15.5.27 — irrelevant to TicketDesk, which will
not be pinned to v15.

### 3. Known bugs and limitations

#### 3a. Multiple `Set-Cookie` headers — no bug on 16.4.0

The classic failure mode (headers collapsed into one comma-joined value, silently corrupting cookies)
**does not occur**. Three headers in, three headers out, comma-bearing value intact. Structurally this
is expected: httpxy hands Node's `res.setHeader("set-cookie", <array>)`, and Node emits an array-valued
`set-cookie` as multiple header lines.

> **The trap in this question — read this before citing the famous bug.** Next.js *does* have a
> long-standing, heavily-reported, fix-linked bug in which multiple `Set-Cookie` headers get
> comma-joined and cookies are silently corrupted. It is real
> ([PR #47718](https://github.com/vercel/next.js/pull/47718) fixed the main instance on 2023-03-31; a
> same-name residue
> [#64698](https://github.com/vercel/next.js/issues/64698) remains open). **But it lives in the WHATWG
> `Headers` / `@edge-runtime/cookies` layer — `cookies().set()`, `NextResponse`, Route Handlers,
> middleware — not in the config-rewrite proxy.** The external-rewrite path never constructs a
> `Headers` object; it writes raw Node headers, which is precisely why it is structurally immune. I
> surveyed the tracker specifically for `rewrites()` instances of this bug and found **none**. If you
> read only one warning in this document, make it this one: the most-cited "Next.js mangles Set-Cookie"
> evidence does not apply to this design, and citing it as if it did would be a mistake.

The same distinction resolves the most-cited "rewrites drop Set-Cookie" claim in circulation: it traces
back to [issue #29488](https://github.com/vercel/next.js/issues/29488), which reported exactly
TicketDesk's topology (same host, different port) — and whose author **retracted it in the thread**:
"The problem is that if that server contains a `Set-Cookie` header, that is dropped when it gets to the
client" … then "What the heck! It *is* working. Sigh." **The canonical scare story is a self-retracted
report about a dev-server that had not been restarted; it is not evidence of a defect.**

A note on the *browser-side* API: `Set-Cookie` is on the Fetch standard's list of **forbidden
response-header names** (<https://fetch.spec.whatwg.org/>: "A forbidden response-header name is a
header name that is a byte-case-insensitive match for one of: … `Set-Cookie`"), so client-side
JavaScript cannot read the session cookie out of `response.headers.get("set-cookie")` — it returns
`null` even though the browser has stored the cookie. That is expected and desirable for an `HttpOnly`
session cookie: the browser stores it, page script cannot read it. Do not write code that depends on
reading `Set-Cookie` from a client-side `fetch` response.

*(Confidence: high on the forbidden-header-name rule — it is quoted from the spec. I did not verify in
a real browser what `Headers.getSetCookie()` does on a fetch `Response`, and the spec text I retrieved
did not settle whether that accessor is subject to the same filtering. It does not matter here: the
cookie is stored either way, which is the whole requirement.)*

#### 3b. Cookie-domain rewriting — an explicit `Domain` attribute is NOT rewritten

The proxy forwards `Domain=` untouched rather than rewriting it to match the browser-facing host:

```http
=== Domain=localhost through :3000 ===
set-cookie: d1=v1; Domain=localhost; Path=/; HttpOnly        ← unmodified
```

This is usually what you want, but it has a sharp edge. When the upstream sets a `Domain` that does
*not* cover the browser-facing host, the browser discards the cookie — and the proxy will not save you:

```http
=== Domain=example.com through :3000 (wire) ===
set-cookie: m1=v1; Domain=example.com; Path=/; HttpOnly      ← forwarded as-is
=== cookie jar after ===
(no cookie stored -> rejected)
```

**Design consequence:** the NestJS app must **not** set an explicit `Domain` attribute on the session
cookie (the `express-session` / `cookie` defaults omit it, which is correct). Omitting `Domain` yields a
host-only cookie scoped to `localhost`, which is exactly right. Setting `Domain=localhost` also works
(verified). Setting anything else silently drops the session.

This is the only `Set-Cookie`-related defect with real tracker history, and it corroborates the
measurement exactly:

* [Issue #23036](https://github.com/vercel/next.js/issues/23036), *"The rewrites in the config don't
  update the domain on set-cookie headers"* — "the cookies aren't set on the client because the domain
  will still have the old value". **Closed by a core maintainer (`timneutkens`) the next day, locked,
  with zero comments and no fix.** Still true today.
* [Issue #28323](https://github.com/vercel/next.js/issues/28323) / Discussion #28329 — asked to expose
  `cookieDomainRewrite`; **closed by a maintainer within two hours, never implemented.** Confirmed:
  `cookieDomainRewrite` has **0 hits** across the whole canary repository. So this is a *declined*
  feature, not an oversight, and it will not be fixed by upgrading.

That the option was refused while `httpxy` still carries the code path is the mechanism-level reason
`#23036` could not be worked around — and, from TicketDesk's side, the reason to simply never set
`Domain`.

#### 3c. `Location` header is NOT rewritten — the one real caveat

This is the most consequential limitation I found, and it is unrelated to `Set-Cookie`:

```http
=== 302 from upstream, through :3000 (no follow) ===
HTTP/1.1 302 Found
set-cookie: redir=1; Path=/; HttpOnly
location: http://localhost:3001/api/whoami          ← leaks the upstream origin
```

The `Set-Cookie` survives; the `Location` does not get rewritten. A redirect issued by NestJS hands the
browser an absolute `http://localhost:3001/...` URL, so the browser follows it **directly to `:3001`**,
leaving `:3000` and breaking the "the browser only ever talks to `localhost:3000`" invariant.

The mechanism explains it: `httpxy` supports `hostRewrite`, `autoRewrite` and `protocolRewrite` for
exactly this purpose, and Next.js passes **none** of them — the same pattern as the cookie options. So
an upstream `Location` is forwarded verbatim. There is no tracker issue for this, which means it is a
config gap rather than a bug anyone has filed; do not expect an upstream fix.

**Design consequence:** the auth design must not rely on upstream-issued HTTP redirects. Log in, log
out, and post-login navigation must be driven by the client (JSON response + `router.push`) or by
NestJS returning a relative `Location`, rather than a `302` to an absolute `:3001` URL. This is a
constraint on the API's responses, not on the transport for cookies.

#### 3d. Error responses still carry `Set-Cookie`

A `500` from the upstream forwards its `Set-Cookie` normally (measured). Cookie-setting on error paths
(e.g. clearing a session on an auth failure) works through the proxy.

#### 3e. What the official docs do and do not say

**The docs are silent.** This is worth stating plainly because it is why the question felt risky: there
is *no* documented guarantee about response-header forwarding through `rewrites()`. Grepping the full
v16 docs corpus (`llms-full.txt`, 4.2 MB):

| Term | Occurrences in whole corpus |
|---|---|
| `Set-Cookie` in the rewrites documentation | **0** |
| `Access-Control-Allow-Credentials` | **0** |
| `credentials: 'include'` | **0** |
| `localhost:3001` | **0** |

The rewrites reference page calls rewrites a "URL proxy" and documents rewriting to external URLs, but
never discusses *response* headers at all — there is no sentence affirming forwarding and none denying
it. The nearest official statement is in the Backend-for-Frontend guide, which presents a Route Handler
returning the upstream `Response` verbatim (`return fetch(proxyRequest)`) as the "Proxying to a
backend" pattern, and lists `rewrites` as an alternative — but never states anything about headers.

**Interpretation:** the behaviour is real, measured, and structurally sound, but it is *undocumented*.
Undocumented behaviour can change without a semver-major and without a changelog entry, and there is no
test suite you can point at as a contract. The `Set-Cookie` unit tests inside the Next.js repo are the
closest thing to a contract — the issue-tracker survey below reports what is known about regressions.

### 4. Does the answer differ by request type? — No

Measured identical `Set-Cookie` output for every browser-issued request shape:

| Request | `Set-Cookie` forwarded? |
|---|---|
| Initial page load / plain navigation (`GET` through the proxy) | Yes — 3/3 |
| Client-side navigation (`RSC: 1` + `Next-Router-State-Tree` headers) | Yes — 3/3 |
| Prefetch (`RSC: 1` + `Next-Router-Prefetch: 1`) | Yes — 3/3 |
| `POST` (the login case) | Yes — 3/3 |

This is expected: from the browser's perspective all of these are ordinary requests to `:3000` that the
server-side rewrite layer proxies. The rewrite decision is made per-request by URL match, not by request
type.

**One genuine exception — rewrite *selection* can go stale on client-side navigation.** The measurement
above is about *header forwarding*, and on that axis the answer is uniformly yes. But there is a
separate, open defect about which route a cookie-*matching* rewrite selects. Next.js's own team has a
draft failing repro,
[PR #92632](https://github.com/vercel/next.js/pull/92632) (*"test: add failing repro for cookie rewrite
refresh"*, open and failing as of 2026-10-10), whose body says:

> "if route selection depends on a `beforeFiles` rewrite that matches on the cookie instead, the client
> can keep rendering the previously selected route even after the action response has already set the
> new cookie … the app stays on the signed-out page until a hard refresh causes the rewrite to run
> against a fresh request."

So on a **hard/initial load** a cookie-matching rewrite sees the current cookie, but after a
**client-side server-action round trip** that changes the cookie, the client may keep rendering the
stale route until a hard refresh. This matters for TicketDesk only if you implement route selection —
which page to render — via `rewrites()` rules that match on the session cookie. **Do not do that.** Gate
on the server (a layout/Server Component reading `cookies()`, or a client-side redirect) rather than on
a cookie-matching rewrite, and this defect cannot bite. It does not affect forwarding `Set-Cookie` back
to the browser, so the login flow itself is unaffected.

*(Confidence: medium — the repro is real, team-authored and currently failing, but it is a draft and
unmerged, so the exact scope may shift.)*

### 5. React Server Components — the answer DOES differ, and this is important

Server-side `fetch` **does not go through the rewrite at all**. A Server Component fetching the
relative rewrite path:

```
(a) relative: ERROR Failed to parse URL from /api/login
```

A relative URL throws outright — rewrites are a *browser-facing routing* feature; they are not applied
to `fetch` calls made by the server. Using an absolute upstream URL works, and the server does receive
the headers:

```
(b) absolute: status=200
setCookie=["sid=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
           "theme=dark; Path=/; SameSite=Strict",
           "junk=a,b; Path=/"]
```

But — and this is the part that must not be missed — **the browser response carried no `Set-Cookie` at
all**, while the RSC page's own response was `HTTP/1.1 200 OK` with no cookie headers:

```http
=== RSC page: response headers the BROWSER receives ===
HTTP/1.1 200 OK
(no set-cookie)
```

The server received the cookies and kept them. Nothing relays them to the browser. A Server Component
cannot set a browser cookie by fetching an endpoint that returns `Set-Cookie` — the request/response
pair that the browser participates in is the RSC page's own, and that pair never sees the upstream's
headers. There is no "forwarding" of cookies across those two hops, because they are two separate HTTP
transactions.

This also matches the documented `cookies()` constraint: setting cookies is not supported during Server
Component rendering, and `.set` is only valid in a Server Function or Route Handler.

**Design consequence:** server-side code (RSC, Server Actions) must talk to `http://localhost:3001`
**directly with absolute URLs**, and must propagate cookies explicitly — read them with `cookies()` and
set them itself, or use a Server Action / Route Handler. It cannot free-ride on the browser's rewrite.
For TicketDesk's browser-driven login flow this is a non-issue, since the login POST originates in the
browser.

This is corroborated by a real report:
[Discussion #60573](https://github.com/vercel/next.js/discussions/60573), *"forward cookies in the
proxy"* (App Router, 2024-01-12, unanswered) — a Server Component calling `fetch` with
`credentials: 'include'` gets no cookies, because an absolute server-side `fetch` never enters the
Next.js server and so `rewrites()` cannot apply. The reporter is effectively asking the rewrite to act
as a server-side HTTP client, which it does not. *(Confidence: the mechanism is certain — I measured
it; the discussion itself is an unanswered user report, and I note it only because it independently
describes the same trap.)*

### 6. Does a different port on the same host change the answer? — No, and it is what makes this work

Two independent reasons, one measured and one from the spec.

**Measured:** the cookie jar stored the cookies against host `localhost` and replayed them to `:3000`
without any port involvement. Every test above ran across the `3000`→`3001` boundary.

**Spec:** RFC 6265 §8.5 states outright that "**Cookies do not provide isolation by port**", and notes
the cookie "is also readable by a service running on another port of the same server"; the Introduction
says "cookies for a given host are shared across all the ports on that host." Domain matching
(§5.1.3) is host-based; ports never enter into it. So `localhost:3001` setting a cookie for host
`localhost` is indistinguishable, to the browser, from `localhost:3000` setting it.

This is the mechanism behind the whole design: because cookies ignore ports, the browser treats the
rewritten API as same-origin with the page. The cookie is stored for `localhost`, sent to `:3000`, and
the proxy forwards it upstream. **Had Next.js stripped `Set-Cookie`, the different port would have been
irrelevant and there would be no workaround** — but it does not strip it.

A security note that follows from the same RFC text: since cookies ignore ports, the session cookie is
*also* sent to anything else on `localhost:3001` (and any other port). This is a local-development
concern only and does not change the architecture.

### 7. Issue-tracker survey — the tracker agrees with the measurement

Because the docs are silent, I also surveyed the `vercel/next.js` tracker (issues, PRs, discussions) for
any report of a config-level `rewrites()` rule dropping or corrupting `Set-Cookie`. The headline is a
**negative result, and it is useful**:

> **There is no issue, in any year, in which a `next.config.js` `rewrites()` rule is reported to drop
> the outbound `Set-Cookie` header, and no maintainer statement that it does.** The complete set of
> `rewrites` + `"set-cookie"` issues is five results, and none is a drop report.

What the tracker *does* contain:

| Item | What it says | Status |
|---|---|---|
| [#23036](https://github.com/vercel/next.js/issues/23036) | `Domain` not rewritten on `Set-Cookie` — the defect I measured in §3b | Closed by a core maintainer, **no fix**, still true |
| [#28323](https://github.com/vercel/next.js/issues/28323) | Request for `cookieDomainRewrite` on rewrites | Closed unactioned, **never implemented** |
| [#29488](https://github.com/vercel/next.js/issues/29488) | Claimed `Set-Cookie` was dropped on a same-host/different-port rewrite | **Self-retracted by the reporter** — a dev server hadn't been restarted |
| [#92632](https://github.com/vercel/next.js/pull/92632) | Cookie-*matching* `beforeFiles` rewrite stays stale after a client-side server action | Open draft, team-authored, **failing test**, no fix |
| [#47718](https://github.com/vercel/next.js/pull/47718) | Fixed multiple-`Set-Cookie` comma-joining | Merged 2023-03-31 — but in the `Headers`/middleware layer, **not** the rewrite proxy |

I found **no** report of a rewrite stripping or altering `Max-Age`, `Expires`, `Path`, `SameSite`,
`HttpOnly` or `Secure`, and **no** report of a rewrite comma-joining multiple `Set-Cookie` headers. The
absence is corroborated by the mechanism: the external-rewrite path never constructs a WHATWG `Headers`
object, so the layer that produced the famous collapsing bug is not in the path at all.

*Search caveat: GitHub's issue search is not a perfect full-text index — multi-word queries sometimes
degrade, and phrase queries behave inconsistently. I compensated with quoted-phrase, title-scoped and
code searches, but treat the negatives as strong rather than formally exhaustive. Confidence: high, not
certain.*

---

## Limitations and caveats that DO affect the design

Restating the findings that constrain the design, **none of which is about `Set-Cookie` forwarding**:

1. **No upstream redirects.** The `Location` header is not rewritten, so a NestJS `302` to an absolute
   `:3001` URL sends the browser off-origin. Use JSON responses plus client-side navigation, or
   relative `Location` values. *(Certain — measured.)*
2. **Server-side code bypasses rewrites.** RSC and Server Action `fetch` calls need absolute upstream
   URLs, and cookies must be propagated explicitly via `cookies()`. A Server Component cannot set a
   browser cookie by calling a cookie-setting endpoint. *(Certain — measured.)*
3. **Do not set an explicit `Domain` attribute** on the session cookie unless it matches the
   browser-facing host (`localhost`). A mismatched `Domain` is forwarded unmodified and rejected by the
   browser, silently losing the session. *(Certain — measured; tracker issue #23036, unfixed since
   2021.)*
4. **Do not select routes with cookie-matching rewrites.** An open Next.js draft repro (#92632) shows
   that a `beforeFiles` rewrite matching on the session cookie keeps rendering the stale route after a
   client-side server action changes the cookie, until a hard refresh. Gate on the server instead.
   *(Medium — open draft, unmerged.)*
5. **You cannot repair `Set-Cookie` with a config `headers()` rule.** External rewrites return
   `resHeaders: null` and `router-server.ts` skips applying `headers()` rules on that path.
   *(Medium-high — code-verified, no tracker issue.)*

Also worth recording: this behaviour is **undocumented**, so it is not a contractual guarantee. The
mitigation is cheap — the test harness in Appendix A is a few dozen lines and makes a good smoke test to
keep in CI, since a silent regression here would break auth in a way that is easy to misattribute to the
NestJS app.

### Workarounds, had this failed

Recorded for completeness, since the ticket asked. **None of them is needed** — the primitive works.
They are relevant only as a defence-in-depth fallback if a future Next.js release regresses the
pass-through, in which case:

* **Preferred fallback: a Route Handler as an explicit proxy** (`app/api/[...path]/route.ts`) that
  forwards the request and returns the upstream `Response`, re-applying `Set-Cookie` explicitly via
  `NextResponse` — this is the officially documented "Proxying to a backend" BFF pattern, and it makes
  the header handling explicit code you control rather than undocumented framework behaviour.
* **Alternative: drop the rewrite and call `:3001` directly** with
  `credentials: 'include'` plus CORS configured on NestJS for exactly `http://localhost:3000` with
  `Access-Control-Allow-Credentials: true`. This works for the browser-driven flow but is strictly worse
  here: it needs `SameSite=None; Secure` on the session cookie (browsers reject `SameSite=None` without
  `Secure`), it makes every request preflighted or credentialed-cross-origin, and it puts `:3001` in the
  browser's network view and in any `Location` header. It buys nothing over the rewrite.
* **Not a workaround: middleware / `proxy.ts`.** Middleware runs on requests, and `NextResponse.rewrite`
  is a different mechanism from a config-level `rewrites()` rule; it is not a fix for response-header
  forwarding.

---

## Appendix A: reproducing the test

Run from an empty scratch directory (not inside the repo). Requires Node and network access to npm.

```bash
mkdir -p /tmp/ndx-test/app /tmp/ndx-test/upstream && cd /tmp/ndx-test
npm init -y
npm install next@16.4.0 react react-dom
npm install -D typescript @types/react @types/node
```

`next.config.ts` — as shown in [the harness section](#the-test-harness).

`upstream/server.mjs` (upstream API on `:3001`):

```js
import http from "node:http";

http.createServer((req, res) => {
  if (new URL(req.url, "http://localhost:3001").pathname === "/api/login") {
    res.setHeader("Set-Cookie", [
      "sid=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
      "theme=dark; Path=/; SameSite=Strict",
      "junk=a,b; Path=/",
    ]);
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  }
  res.statusCode = 404;
  res.end("nope");
}).listen(3001);
```

`app/page.tsx` and `app/layout.tsx` can be minimal. Then:

```bash
node upstream/server.mjs &            # :3001
npx next build && npx next start -p 3000 &   # :3000

# The assertion that matters: three separate Set-Cookie headers, attributes intact.
curl -sS -D - -o /dev/null http://localhost:3000/api/login | grep -ci '^set-cookie:'   # -> 3

# Browser-storage semantics: jar records the cookie, then replays it via the proxy.
rm -f cj.txt
curl -sS -c cj.txt -b cj.txt -o /dev/null -X POST http://localhost:3000/api/login
grep -c 'HttpOnly' cj.txt            # -> 1
```

---

## Sources

All URLs accessed 2026-10-10.

**Primary — measured**

* Next.js `16.4.0`, installed from npm (`npm view next dist-tags` → `latest: 16.4.0`, published
  2026-10-06). Test harness as in Appendix A; results quoted inline above.

**Primary — Next.js source (`next@16.4.0`, installed package)**

* `node_modules/next/dist/server/lib/router-utils/proxy-request.js` — the external-rewrite proxy;
  `httpxy` instantiation and options. Upstream equivalent:
  <https://github.com/vercel/next.js/blob/v16.4.0/packages/next/src/server/lib/router-utils/proxy-request.ts>
* `node_modules/next/dist/compiled/httpxy/index.js` — the vendored proxy library in 16.4.0 (it
  succeeded `http-proxy`, still present in 15.5.27); `setHeader` and the dormant `cookieDomainRewrite`
  / `cookiePathRewrite` / `hostRewrite` paths.

**Primary — spec**

* RFC 6265, *HTTP State Management Mechanism* — <https://www.rfc-editor.org/rfc/rfc6265.html>
  §8.5 ("Cookies do not provide isolation by port"), §5.1.3 (domain matching), §5.1.4 (default-path),
  §5.3 (storage model).

**Primary — official docs** (absence verified by grepping
<https://nextjs.org/docs/llms-full.txt>, 4.2 MB, `@doc-version: >=v16.4.0`)

* `rewrites()` reference — <https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites>
  ("Rewrites act as a URL proxy…"; "Rewriting to an external URL"). Says nothing about response headers.
* `cookies()` reference — <https://nextjs.org/docs/app/api-reference/functions/cookies>
  ("Setting cookies is not supported during Server Component rendering…"; "HTTP does not allow setting
  cookies after streaming starts").
* Backend-for-Frontend guide — <https://nextjs.org/docs/app/guides/backend-for-frontend>
  ("Proxying to a backend"; Route Handler returning the upstream `Response`).
* CORS in `headers()` — <https://nextjs.org/docs/app/api-reference/config/next-config-js/headers#cors>
* Migration from Create React App, "Proxying API Requests" —
  <https://nextjs.org/docs/app/guides/migrating-from-create-react-app> (the documented
  `rewrites()`-as-API-proxy idiom).
* Next.js 16 release notes (`proxy.ts` replaces `middleware.ts`) —
  <https://nextjs.org/blog/next-16>

**Primary — spec (Fetch)**

* WHATWG Fetch Standard — <https://fetch.spec.whatwg.org/> ("A forbidden response-header name is a
  header name that is a byte-case-insensitive match for one of: … `Set-Cookie`").

**Secondary but citable — `vercel/next.js` tracker** (surveyed via the `gh` CLI; see §7)

* [#23036](https://github.com/vercel/next.js/issues/23036) — `Domain` not rewritten on config-rewrite
  `Set-Cookie`; closed by a maintainer, no fix, still true.
* [#28323](https://github.com/vercel/next.js/issues/28323) — request for `cookieDomainRewrite`; closed
  unactioned. Mirror: [#28329](https://github.com/vercel/next.js/discussions/28329).
* [#29488](https://github.com/vercel/next.js/issues/29488) — the canonical "Set-Cookie is dropped"
  report, same-host/different-port; **self-retracted by its author**.
* [#92632](https://github.com/vercel/next.js/pull/92632) — open, team-authored draft repro: cookie-
  matching `beforeFiles` rewrite goes stale after a client-side server action.
* [#47718](https://github.com/vercel/next.js/pull/47718) — merged fix for multiple-`Set-Cookie`
  comma-joining (the `Headers`/middleware layer, **not** the rewrite proxy). Residual open case:
  [#64698](https://github.com/vercel/next.js/issues/64698).
* [#96060](https://github.com/vercel/next.js/pull/96060) — merged: vendored `http-proxy` replaced by
  `httpxy` (2026-07-27).
* [#60573](https://github.com/vercel/next.js/discussions/60573) — server-component `fetch` gets no
  cookies (unanswered; correct-by-design).

**Caveat on the negatives.** GitHub's issue search is not a rigorous full-text index. The *absence* of
a tracker report about config rewrites dropping `Set-Cookie` is therefore strong evidence but not
proof; the measurement in §1 and the source in §1's mechanism note are what actually carry the verdict.
