# SQLite + Prisma, with no database-level enumerations

Persistence is SQLite through Prisma. Postgres was rejected as overkill for a small learning project — one file, zero setup, no container.

**Prisma supports no `enum` type on SQLite.** The consequence is that `User.role`, `Ticket.priority`, and `Ticket.status` are `String` columns: nothing in the database stops `status = 'opne'`. The legal values are guaranteed only by TypeScript union types and by Zod validation at the API boundary.

This ADR exists because the code looks like a mistake. A reader who sees `status String` will reasonably conclude someone forgot to model the enum and will "fix" it — either by moving to Postgres, or by adding a check constraint that Prisma will not manage. Neither is wrong, but both are changes to a decision that was made on purpose.

## Considered options

- **Postgres + `docker-compose`** — native enums, faithful constraints, one more moving part. Rejected as disproportionate to the project's size. This is the change to make if the data ever matters.
- **SQLite with `String` columns validated in the application** — chosen.
