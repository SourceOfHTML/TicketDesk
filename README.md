# TicketDesk

A local helpdesk ticket tracker: Requesters raise Tickets, Staff triage and close them.

The domain vocabulary lives in [`CONTEXT.md`](CONTEXT.md), the architecture decisions in
[`docs/adr/`](docs/adr/), and the visual language in [`DESIGN.md`](DESIGN.md). The spec is GitHub
issue [#30](https://github.com/SourceOfHTML/TicketDesk/issues/30).

## Getting started

Requires Node 24 (see `.nvmrc`) and pnpm 12. If pnpm is not installed:

```sh
corepack enable pnpm
```

Then:

```sh
pnpm install
pnpm bootstrap   # creates .env if absent, migrates the database, seeds Staff
pnpm dev         # API on :3001, web on :3000
```

`pnpm dev` runs `pnpm bootstrap` first, so it is self-sufficient after `pnpm install`.

The browser only talks to `:3000`. A Next rewrite proxies `/api/*` to Nest on `:3001`, which keeps
the session cookie first-party.

The Staff account created by the seed comes from `STAFF_EMAIL` and `STAFF_PASSWORD` in `.env`.

## Workspace

| Path              | What it is                                                            |
| ----------------- | --------------------------------------------------------------------- |
| `apps/api`        | NestJS API — database, validation, authorization, every business rule |
| `apps/web`        | Next.js App Router UI — renders, decides nothing                      |
| `packages/shared` | Zod schemas and their inferred types, imported by both                |

## Gates

```sh
pnpm gates   # lint → typecheck → format:check → test, run-all
```

Run `pnpm bootstrap` once first: it creates `.env` and generates the Prisma client. After that, each
gate can also be run alone: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`.
`pnpm format` rewrites formatting. GitHub Actions runs `pnpm bootstrap` and then `pnpm gates` on
every push, pull request, and manual dispatch.

## The Set-Cookie smoke job

```sh
pnpm smoke:cookie   # needs curl; owns its setup, database included
```

It proves against the real built apps that the session cookie survives the Next rewrite and is
refreshed on replay — the one undocumented behaviour the auth design rests on. It takes a couple of
minutes, needs ports 3000 and 3001 to itself, and is deliberately outside `pnpm gates`:
`.github/workflows/smoke-cookie.yml` runs it, and it is not a required status check.

## Why the API dev server uses SWC

`tsx` compiles with esbuild, which does not emit `design:paramtypes`. Nest then constructs controllers
with no arguments and the failure surfaces later inside a handler, as a `TypeError` on an
`undefined` dependency. The API dev server therefore runs under `@swc-node/register`, which reads
`emitDecoratorMetadata: true` from `tsconfig.json` and emits the metadata. `tsx` remains the runner
for scripts and the seed, where no decorators are involved. Vitest uses Vite 8 (Oxc), which emits the
metadata too; `apps/api/test/di.e2e-spec.ts` guards that path.

## Database changes

`migrate deploy` only applies committed migrations. After editing
`apps/api/prisma/schema.prisma`, author a migration by hand:

```sh
pnpm exec prisma migrate dev --name <name>
```

The Prisma client is generated into `apps/api/src/generated/prisma` (gitignored) by `pnpm bootstrap`.
