# Sessions are hand-rolled and database-backed

Authentication is a `Session` row (`{ id, userId, expiresAt, createdAt }`) whose primary key — an opaque random token — is handed to the browser as an `httpOnly` cookie and is valid for 7 sliding days. Logout deletes the row. Passwords are hashed with argon2id.

The obvious choice is an auth library: Auth.js on the Next side, or `passport-local` + `express-session` on the Nest side. On a product that would be the right call. It was rejected here for two reasons — the libraries hide precisely the cookie and session mechanics the exercise exists to teach, and their session abstractions sit awkwardly against the explicit "session cookies" requirement rather than implementing it directly.

## Consequences

- Session revocation is immediate and trivial: logout, or expiry, is a row deletion.
- There is no OAuth, no magic link, and no password reset, and adding one means touching the guard layer rather than flipping a provider.
- `Session` is an entity in the data model that exists for no other reason.
