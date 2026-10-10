# NestJS owns the domain; Next.js is a thin UI

TicketDesk is built as two services: `apps/api` (NestJS) holds the database, validation, authorization, and every business rule, while `apps/web` (Next.js, App Router) is a thin UI that decides nothing. The browser only ever talks to `:3000`, because `apps/web/next.config.ts` rewrites `/api/:path*` to the NestJS app on `:3001` — which keeps the session cookie first-party and removes CORS from the design entirely.

This is the wrong shape for an app of this size on the merits: a single Next.js app with route handlers would be simpler, cheaper, and harder to get wrong. **NestJS is a requirement of the exercise, not a technical preference**, so the cost — two processes, two build pipelines, and a seam that has to be right — is accepted knowingly. It is recorded here so a future reader does not "simplify" it back into one service without knowing the constraint existed.

## Consequences

- **The API is the only security boundary.** `apps/web` may hide a control a user cannot use, but it is never what stops them; the guards in `apps/api` are.
- Authorization, validation, and the ticket status machine have exactly one implementation, in `apps/api`.
- `packages/shared` exists mainly to hold the Zod schemas both sides import.
