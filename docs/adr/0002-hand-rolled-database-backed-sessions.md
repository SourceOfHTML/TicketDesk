# Sessions are hand-rolled and database-backed

Authentication is a `Session` row (`{ id, userId, expiresAt, createdAt }`) whose primary key — an opaque random token — is handed to the browser as an `httpOnly` cookie and is valid for 7 sliding days. Logout deletes the row. Passwords are hashed with argon2id.

The obvious choice is an auth library: Auth.js on the Next side, or `passport-local` + `express-session` on the Nest side. On a product that would be the right call. It was rejected here for two reasons — the libraries hide precisely the cookie and session mechanics the exercise exists to teach, and their session abstractions sit awkwardly against the explicit "session cookies" requirement rather than implementing it directly.

## Consequences

- Session revocation is immediate and trivial: logout, or expiry, is a row deletion.
- There is no OAuth, no magic link, and no password reset, and adding one means touching the guard layer rather than flipping a provider.
- `Session` is an entity in the data model that exists for no other reason.
- **The sliding window is real, and it costs a write.** `SessionGuard` refreshes `expiresAt` and re-issues the cookie with a recomputed `Max-Age` on every authenticated request, so the browser's cookie and the row expire together rather than the cookie dying at a fixed 7 days while the row slides on. A session used at least once every 7 days therefore lives indefinitely: there is deliberately **no absolute cap**, **no elapsed-time threshold** before refreshing, and **no token rotation** — rotating `Session.id` would invalidate a sibling tab's in-flight cookie. Logout is the one exception, and the guard refreshes there too, so the handler's clear must be the **last** `Set-Cookie` on that response or a deliberate sign-out lands on `/login?expired=1`.
