# Prisma + SQLite under test

**Status:** research findings. Measured against real installs — **Prisma 6.19.0** (built-in Rust engine) and
**Prisma 7.10.0** with `@prisma/adapter-better-sqlite3`, on Node 24.13, an 8-physical/16-logical-core Linux box —
plus primary sources. Measurements are marked **[measured]**; anything unconfirmed is marked **UNVERIFIED**.
**Question:** how do you run a test suite against a Prisma + SQLite database — isolation, schema delivery, and the
traps that fail silently?

---

## TL;DR

1. **In-memory SQLite does not exist under Prisma, and it does not error.** `file::memory:` and
   `file::memory:?cache=shared` both produce a *file* — named `:memory:` under Prisma 6, named `:memory:?cache=shared`
   under Prisma 7 + `better-sqlite3`. Neither is in-memory. **This retires the option entirely**; there is no faster
   in-memory variant to reach for.
2. **The two Prisma generations handle SQLite connections completely differently, and this dominates every other
   finding.** Prisma 6 pools: `physical_cpus × 2 + 1`, measured at **17 open handles** under concurrency, which is why
   `?connection_limit=1` exists and why the engine deadlocks on concurrent interactive transactions above the core
   count. Prisma 7 **requires a driver adapter** and, for `better-sqlite3`, holds **exactly one** connection — no pool,
   no deadlock.
3. **WAL is not on by default, so a plain file copy of a SQLite database is safe today.** Prisma never sets
   `journal_mode`; the default is `delete`, with no `-wal`/`-shm` sidecars. `VACUUM INTO` is the only snapshot method
   that stays correct if WAL ever arrives.
4. **`db push` and `migrate deploy` produce byte-identical schema on a fresh file** — measured. The choice between them
   is about which one is *exercised*, not about the resulting schema.
5. **Three open, confirmed Prisma/Vitest interactions to design around**: fake timers hang queries, `prisma-client-js`
   with a custom output resolves to `index-browser.js`, and the v6 engine has a confirmed segfault under Vitest.

---

## 0. The version caveat, stated first

Prisma 6 and Prisma 7 differ on nearly everything this document covers, and a reader who assumes one while the project
is on the other will design the wrong thing.

- **Prisma 6** — the Rust query engine, a connection pool, `prisma-client-js` or `prisma-client` generator, a CLI that
  loads `.env`.
- **Prisma 7** — a driver adapter is **required**: `new PrismaClient()` with no options throws
  `PrismaClient was instantiated without any options. A driver adapter is required to connect to your database.`
  **[measured]**. No pool for `better-sqlite3`. The CLI **no longer loads `.env`**.

Also note: **`prisma/prisma` has been renamed `prisma/orm`.** Old issue URLs still redirect.

---

## 1. In-memory SQLite does not exist under Prisma

This is the finding most likely to be rediscovered the hard way, because the failure is silent and the file it leaves
behind has a misleading name.

### Prisma 6 — the engine parses `file:` and discards everything else

`SqliteParams::try_from` strips the `file:` prefix, splits on `?`, and takes `path_parts[0]` as the **file path**.
`?cache=shared` is not a recognised parameter and is discarded with a debug log. The path is resolved relative to the
schema directory and opened as a file.

- **[measured]** `url = "file::memory:"` → `PRAGMA database_list` returns `file: /tmp/.../prisma/:memory:`; a 12 KB file
  named `:memory:` appears on disk; rows persist across separate `node` processes; `journal_mode` is `delete`, not
  `memory`.
- **[measured]** `file::memory:?cache=shared` hits that same file.
- **[measured]** Bare `:memory:` is rejected with a Prisma validation error — the `file:` prefix is mandatory.

### Prisma 7 + `@prisma/adapter-better-sqlite3` — the adapter strips only `file:`

`createBetterSQLite3Client` does `const dbPath = url.replace(/^file:/, "")` and hands the rest to `better-sqlite3`,
which does not enable URI filenames — so the query string is never parsed and becomes part of the filename.

- **[measured]** `:memory:` (no `file:` prefix) → a genuine in-memory database: `PRAGMA database_list` returns `file: ""`.
  Data persists across 20 concurrent queries on one client, but a **second `PrismaClient` in the same process sees 0
  rows** — it is private per connection.
- **[measured]** `file::memory:?cache=shared` → a real path, and a file named `:memory:?cache=shared` created on disk.

### There is no documented guidance

There is **no Prisma documentation page on in-memory SQLite at all**. A search of the docs source finds zero hits for
`cache=shared`, and the SQLite connector page has no `:memory:`, no `connection_limit`, and no pooling section. The
only in-repo uses are internal: the adapter's own `connectToShadowDb()` uses `":memory:"`, and Prisma 8's SQLite driver
tests bind `{ kind: 'path', path: ':memory:' }`.

### Consequences

- `cache=shared` is **process-scoped**, not connection-scoped (SQLite's own semantics) — moot for Prisma 6, which never
  reaches in-memory mode at all.
- Related open/closed issues: **#11129** (open) "Allow connecting to an in-memory dummy database"; **#23837** (open)
  Prisma Client silently creates empty SQLite files; **#30702** (closed) `@prisma/adapter-libsql` `:memory:` +
  `$transaction` permanently redirects later queries to an empty database; **#11789** (closed) timeouts under
  `Promise.all`; **#10403** (closed) `SQLITE_BUSY` mis-mapped to `SocketTimeout`.

---

## 2. Connection pooling: the two generations diverge completely

### Prisma 6 — `physical_cpus × 2 + 1`

The pool default is set in `Builder::new` and applied as `max_open`.

- **[measured]** on an 8-physical-core box: **1** handle after one query; **17** after 40 concurrent `SELECT`s; **17**
  after 20 concurrent interactive transactions (= 8×2+1).
- **[measured]** with `?connection_limit=1`: exactly **1** handle under all three workloads, and 20 concurrent
  interactive transactions all succeed.
- `connection_limit`, `socket_timeout`, `max_connection_lifetime`, and `max_idle_connection_lifetime` are the only
  parameters `SqliteParams` recognises. `socket_timeout` is what sets `busy_timeout`.
- Prisma's own functional test corpus carries a suite named **`11789-sqlite-with-wal-or-connection_limit`** with cases
  "5 concurrent upsert should succeed with connection_limit=1" and "…with connection_limit=1 & journal_mode = WAL" —
  `connection_limit=1` is Prisma's own sanctioned workaround.

### Prisma 7 — no pool at all

- **[measured]** `@prisma/adapter-better-sqlite3`: exactly **1** handle always; 20 concurrent interactive transactions
  all succeed. Serialised by an internal mutex.
- **"There are no connection URL parameters for these in Prisma ORM v7."** Pool settings belong to the adapter.
- **A `connection_limit=1` parameter in a v7 SQLite URL is not rejected — it becomes part of the filename.**
  **[measured]**: a file literally named `cl.db?connection_limit=1` was created. Same for `file::memory:?cache=shared`.

---

## 3. `DATABASE_URL` resolution at runtime

**The generated Prisma Client does not load `.env` at runtime — in any version.** Setting `process.env.DATABASE_URL`
programmatically is sufficient, and nothing overrides it.

- **[measured] Prisma 6 runtime:** with a `.env` containing `DATABASE_URL`, `process.env.DATABASE_URL` was `undefined`
  both before *and* after `new PrismaClient()`, and the query failed with
  `Environment variable not found: DATABASE_URL`. The client never touches `.env`.
- **[measured] Prisma 6 CLI:** prints `Environment variables loaded from .env`, but with `DATABASE_URL` also exported in
  the shell the CLI used the **shell** value. Standard `dotenv` behaviour: an already-set variable wins, so a
  programmatically-set value is never clobbered.
- **[measured] Prisma 7 CLI:** with `.env` present and no `dotenv` import in `prisma.config.ts`, the CLI **ignored
  `.env` entirely**.
- Prisma 7's docs are explicit: `.env` variables "need to be loaded explicitly" via `dotenv` in `prisma.config.ts`.
  `env("DATABASE_URL")` from `prisma/config` **throws** `PrismaConfigEnvError` when unset — so `prisma generate` can
  fail in CI even though generation needs no database. The docs suggest `process.env.DATABASE_URL ?? ''` when optional.

Prisma 6's CLI lookup order is `.env` at the project root, then the schema folder, then `./prisma/.env`, with a
`There is a conflict between env vars in .env and prisma/.env` error if both define one.

---

## 4. `prisma db push` vs `prisma migrate deploy` on a fresh file

| | `db push` | `migrate deploy` |
| --- | --- | --- |
| What it does | Pushes schema state straight to the database, **no migrations** | Applies pending migrations from `prisma/migrations/`, creating the database if absent |
| `_prisma_migrations` | **Never created or updated** | Writes one row per applied migration |
| Requires a target URL | Yes | Yes |
| Repeatable on an empty file | Yes; `--force-reset` resets then re-syncs | Yes, and idempotent (`No pending migrations to apply.`) |
| Prisma 7 flags | `--force-reset`, `--accept-data-loss`; **`--skip-generate` was removed** and `db push` no longer auto-runs `generate` | `--schema` only |

- **[measured]** on a fresh file: `migrate deploy` ≈ **0.88 s** wall, `db push` ≈ **0.86 s** — both dominated by Node
  start-up; the engine work itself is ~9 ms. Both spawn a separate process.
- **[measured] the physical schema is byte-identical.** Same `CREATE TABLE`, same FK constraint text, same indexes.
  The only difference is the presence of `_prisma_migrations`. Verified on a two-model schema with a relation,
  `onDelete: Cascade`, an `@@index` and a `@unique`.
- **The divergence the docs warn about is drift on an existing database**, not a fresh one: `db push` writes no history,
  so a later `migrate dev` reports `Drift detected: Your database schema is not in sync with your migration history`
  and offers a reset.

**What Prisma itself recommends for test databases — the official sources disagree:**

- **The official Vitest example (this exact stack) uses `db push --force-reset`.** Its `test/test-setup.ts` is
  `execa('pnpm', ['prisma','db','push','--force-reset','--skip-generate'])` wired to Vitest's `globalSetup`.
- **The docs' integration-testing page uses `migrate deploy`** — but that page is Docker + **Postgres**, assumes Jest,
  and never mentions SQLite or Vitest.
- **The unit-testing docs recommend neither** — they say mock Prisma Client entirely with `jest-mock-extended`, assume
  Jest, and never mention Vitest.
- The blog "Testing series" part 3 (Prisma 7, Vitest 4, Express + `@prisma/adapter-pg` + Prisma Postgres) uses
  `db push` and `fileParallelism: false`. No SQLite anywhere in the series.

`db push` is explicitly positioned for prototyping, not production.

---

## 5. Copying a SQLite database file: the WAL hazard

**Prisma does not enable WAL.** The default is rollback-journal, so there are no sidecars and a plain copy of the main
`.db` file is safe.

- **[measured]** `PRAGMA journal_mode` with Prisma 6 on a file database: `delete`. With Prisma 7 + `better-sqlite3`:
  `delete`. For `:memory:`: `memory`. `PRAGMA synchronous` is `2` (FULL). No `-wal` or `-shm` file existed in any
  file-backed run.
- **Source corroboration:** the string `journal_mode` appears **zero** times in the entire `prisma/prisma-engines`
  repository. WAL is an **open feature request** — #3303, "SQLite: Use WAL mode", open since 2020-08-14.
- **[measured] the failure mode, reproduced.** With WAL enabled: sidecars `waltest.db-shm` and `waltest.db-wal` appear;
  `fs.copyFileSync` of **only** the main `.db` → opening the copy throws **`no such table: t`**. The entire schema was
  still in the WAL and was lost. After `PRAGMA wal_checkpoint(TRUNCATE)`, the same copy read correctly. `VACUUM INTO`
  also produced a correct copy. **`_prisma_migrations` would be lost the same way** — it is an ordinary table.
- SQLite's own docs: the WAL file "should be kept with the database if the database is copied or moved"; separating
  them means committed transactions "might be lost, or the database file might become corrupted."

**Correct snapshot methods** (all **[measured]** reachable through Prisma via `$executeRawUnsafe`):

- `PRAGMA wal_checkpoint(TRUNCATE)` — like RESTART, plus truncating the WAL to zero bytes. No effect if WAL is off.
- `VACUUM INTO 'file.db'` — "an alternative to the backup API for generating backup copies of a live database"; the
  output "is a consistent snapshot"; the target must not already exist or must be empty; **fails if there is an open
  transaction on the connection.**
- The `sqlite3` CLI's `.backup` / `.clone` / `.dump`.

**Prisma documents none of this.** There is no Prisma documentation of the WAL copy hazard, and `journal_mode` never
appears in the engine source.

---

## 6. Deleting all rows between tests

- **Prisma's documented pattern is `deleteMany` inside `$transaction`.** The integration-testing guide's `afterAll`
  builds `prisma.orderDetails.deleteMany()` … `prisma.customer.deleteMany()` and runs them as
  `prisma.$transaction([...])`, warning that "the operations need to be executed in the correct order according to how
  the model relations are setup."
- **The docs' generic answer is `TRUNCATE`, but the page gives Postgres and MySQL examples only.** SQLite has no
  `TRUNCATE` statement, so **Prisma documents nothing for SQLite here.**
- **No truncate helper exists.** Open feature requests: #5063 `truncate()`, #5231 `$clear()`/`$truncateAll()`, #5596
  `prisma db truncate`. The only documented reset helper is the CLI's `prisma migrate reset`.

### Foreign keys are enforced at the database level

- **Prisma 7 + `better-sqlite3`: `PRAGMA foreign_keys` is `1` on every connection.** **[measured]** an orphan insert
  fails with **P2003**; deleting a parent before a child inside `$transaction([...])` fails with
  `P2010 … SQLITE_CONSTRAINT_TRIGGER … FOREIGN KEY constraint failed`. SQLite's *own* default is OFF — something in
  the stack turns it on. Prisma 8's SQLite driver README states it plainly: "Enables `PRAGMA foreign_keys = ON` and
  `PRAGMA busy_timeout = 5000` on every opened connection."
- **UNVERIFIED for Prisma 6.** `foreign_keys` appears zero times anywhere under `quaint/`, and the only
  `PRAGMA foreign_keys` statements in `prisma-engines` are in the schema engine's migration DDL. Yet the pragma reads
  `1` at runtime. Either the engine enables it through an unfound path, or `rusqlite`/`libsqlite3-sys` does. FK
  enforcement was not tested under v6.

### `PRAGMA foreign_keys = OFF` is not a usable escape hatch

- **[measured] Prisma 7 + `better-sqlite3`:** the pragma works and reads back `0`, and because the adapter holds one
  connection it holds for the whole client.
- **[measured] Prisma 6 built-in engine: the pragma applies only to the single pooled connection that ran it.**
  Immediately after, it reads `0`; after forcing the pool open (40 concurrent queries), every one of 20 reads returned
  `1`. **Do not rely on this pragma under the v6 pooled engine.**
- **Inside a transaction it is silently a no-op.** SQLite: setting it "in the middle of a multi-statement transaction
  … does not return an error; it simply has no effect." **[measured]** under Prisma 7,
  `$transaction(async tx => tx.$executeRawUnsafe('PRAGMA foreign_keys = OFF'))` left the value at `1`. This means the
  docs' MySQL pattern (`SET FOREIGN_KEY_CHECKS = 0` inside a transaction) has **no SQLite equivalent.**

### `$transaction` with raw deletes

**[measured]** the batch form `$transaction([p.$executeRawUnsafe('DELETE FROM "Post"'), p.$executeRawUnsafe('DELETE FROM "User"')])`
works and correctly fails with `P2010 / SQLITE_CONSTRAINT_TRIGGER` when the order violates foreign keys. No open issue
was found about `$transaction` + raw deletes specifically. Related real hazards: **#29933** (a single `SQLITE_BUSY` at
`COMMIT` permanently poisons the `better-sqlite3` adapter's mutex — every later `$transaction` fails with P2028, and
non-transactional writes silently land in a zombie transaction rolled back at exit) and **#30028** (the libsql
equivalent).

---

## 7. Migration history and the SQLite table-rebuild

- **[measured]** `prisma migrate deploy` against a fresh SQLite file **does** write `_prisma_migrations`. After the run
  the database contained `['_prisma_migrations', 'User', 'sqlite_sequence']` with columns
  `id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count` and one row.
  Re-running is a clean no-op.
- **Safe to copy as a template, by default** — because Prisma does not use WAL (§5), so the `_prisma_migrations` rows
  live in the main file. The moment anyone adds `PRAGMA journal_mode = WAL`, a naive copy loses the table entirely.
- **The "12-step" ALTER TABLE dance is real and Prisma emits it.** **[measured]** changing `onDelete: Cascade` →
  `Restrict` on SQLite produced exactly:
  ```sql
  -- RedefineTables
  PRAGMA defer_foreign_keys=ON;
  PRAGMA foreign_keys=OFF;
  CREATE TABLE "new_Post" (…);
  INSERT INTO "new_Post" ("authorId","id","title") SELECT "authorId","id","title" FROM "Post";
  DROP TABLE "Post";
  ALTER TABLE "new_Post" RENAME TO "Post";
  CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
  PRAGMA foreign_keys=ON;
  PRAGMA defer_foreign_keys=OFF;
  ```
  Data survived.
- **Known issues with it:** **#29024** (open) Prisma rebuilds the whole table for a simple column change even though
  SQLite 3.35+ supports some `ALTER`s; **#29064** (open) introspection drops parentheses in a `dbgenerated()` default,
  so `migrate dev` regenerates a RedefineTables migration forever.

---

## 8. Vitest-specific incompatibilities

| Issue | Status | What it does |
| --- | --- | --- |
| **#26609** fake timers | Open, `bug/2-confirmed`, no workaround | `vi.useFakeTimers({ toFake: ['setTimeout'] })` + any Prisma query **hangs**. Reproduced on Prisma 5.15 and 6.5.0 / Vitest 3.0.7 / Node 22.12 / Postgres. **Never enable fake timers in a setup file shared with database tests.** |
| **#27627** `index-browser.js` | Open, confirmed | `prisma-client-js` with a custom `output` resolves to `index-browser.js` under Vitest/Vite: `PrismaClient is unable to run in this browser environment`, even with `environment: 'node'`, surfacing in `afterAll()`. Maintainer: "this issue is solved with the new `prisma-client` generator" and "We never recommend manually forcing import path resolution via a different alias." |
| **#18577** crashes under Vitest | Open, `bug/2-confirmed`, `topic: rust panic`, `topic: segmentation fault` | Segmentation fault / bus error / abort with Rust stack traces. **The most severe Vitest item, and the one least likely to be fixed for the v6 engine.** |
| **#22292** coverage + custom output | Closed 2024-12-11 | `@vitest/coverage-v8` tried to read `generated/prisma-client-js/runtime/index-browser.js.map` and threw `ENOENT`. Recommendation: **exclude generated Prisma output from coverage**. |
| **#28105** WASM/Vite | Open | `engineType = "client"` + `runtime = "cloudflare"` emits `await import("./query_compiler_bg.wasm?module")`, which Vite mishandles. Only relevant for the WASM/edge runtime. |

A sweep of the `topic: vitest` label found **8 issues total, only 2 still open** (#27627, #26609). Nothing else about
Vitest is currently open.

---

## 9. Concurrency, `SQLITE_BUSY`, and mis-mapped errors

- **[measured]** `PRAGMA busy_timeout` is **5000 ms** under both generations (v6 sets it from `socket_timeout`; the v7
  adapter sets it directly). Prisma 8's driver README documents the same default.
- **`SQLITE_BUSY` is surfaced as the wrong error.** `quaint` maps `DatabaseBusy` → `SocketTimeout`, and the adapters map
  `SQLITE_BUSY` → `SocketTimeout`, so you get **P1008 "Socket timeout"** with an empty `extra_hint` — misleading for a
  local file. That is **#10403**.
- **#29870 (open): concurrent interactive transactions deadlock the engine above the worker-thread count.**
  **[measured and reproduced independently]**: with the v6 engine, 20 concurrent `$transaction` calls against a file
  database → `P1008 Socket timeout`. Sharp cliff at exactly `logical_cores + 1` (a reporter saw N=15 fail on a 14-core
  box, and N=3 on a 2-CPU container). **The same workload on v7 + `better-sqlite3` passed 20/20.**
- **#28209 (open): no way to set `busy_timeout` for migrations.** `prisma migrate deploy` against a replicated SQLite
  file fails with `SQLite database error / database is locked`.
- Historical: **#2955** (closed 2022) is where `socket_timeout` came from.

---

## 10. What could not be verified

- Whether the **Prisma 6 Rust engine enforces SQLite foreign keys at runtime** (§6) — `foreign_keys` appears nowhere
  under `quaint/`, yet the pragma reads `1`.
- Whether `PRAGMA foreign_keys = OFF` issued **inside** `$transaction` is a no-op under Prisma 6 as well; the silent
  no-op was verified only under v7, though the SQLite documentation statement is engine-independent.
- Any **official Prisma guidance on in-memory SQLite**. It does not appear to exist.
- Any Prisma documentation of the **WAL copy hazard**.
- `@prisma/adapter-libsql`'s connection and pool behaviour — not installed or measured. #30028 and #30702 describe it
  as having a busy-timeout default of 0 unless passed through the adapter config.

---

## Sources

- [Prisma engine — SQLite connection-string parsing (`params.rs`)](https://github.com/prisma/prisma-engines/blob/main/quaint/src/connector/sqlite/params.rs)
- [Prisma engine — connection pool defaults (`pooled.rs`)](https://github.com/prisma/prisma-engines/blob/main/quaint/src/pooled.rs)
- [`@prisma/adapter-better-sqlite3` source](https://github.com/prisma/prisma/blob/main/packages/adapter-better-sqlite3/src/better-sqlite3.ts)
- [Prisma engine — SQLite table-rebuild renderer](https://github.com/prisma/prisma-engines/blob/main/schema-engine/connectors/sql-schema-connector/src/flavour/sqlite/renderer.rs)
- [Prisma — connection pool documentation](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/connection-pool)
- [Prisma — connection management (v7: no URL parameters)](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [Prisma — environment variables](https://www.prisma.io/docs/orm/more/development-environment/environment-variables)
- [Prisma — `prisma.config.ts` reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference)
- [Prisma — migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories)
- [Prisma — prototyping your schema (`db push`)](https://www.prisma.io/docs/orm/prisma-migrate/workflows/prototyping-your-schema)
- [Prisma — integration testing (`migrate deploy`)](https://www.prisma.io/docs/orm/prisma-client/testing/integration-testing)
- [Prisma — unit testing (Jest-only, mocks)](https://www.prisma.io/docs/orm/prisma-client/testing/unit-testing)
- [Prisma official example — `generator-prisma-client/vitest-esm-nodejs` (SQLite, `db push --force-reset`)](https://github.com/prisma/prisma-examples/tree/latest/generator-prisma-client/vitest-esm-nodejs)
- [Prisma blog — testing series part 3 (`db push` + `fileParallelism: false`)](https://www.prisma.io/blog/testing-series-3-aBUyF8nxAnB)
- [SQLite — in-memory databases](https://sqlite.org/inmemorydb.html)
- [SQLite — write-ahead logging](https://sqlite.org/wal.html)
- [SQLite — `VACUUM INTO`](https://sqlite.org/lang_vacuum.html)
- [SQLite — `PRAGMA wal_checkpoint`](https://sqlite.org/pragma.html#pragma_wal_checkpoint)
- [SQLite — foreign key constraints](https://sqlite.org/foreignkeys.html)
- Issues: [#11789](https://github.com/prisma/prisma/issues/11789) · [#10403](https://github.com/prisma/prisma/issues/10403) ·
  [#11129](https://github.com/prisma/prisma/issues/11129) · [#23837](https://github.com/prisma/prisma/issues/23837) ·
  [#30702](https://github.com/prisma/prisma/issues/30702) · [#3303 WAL](https://github.com/prisma/prisma/issues/3303) ·
  [#5063](https://github.com/prisma/prisma/issues/5063) · [#5231](https://github.com/prisma/prisma/issues/5231) ·
  [#5596](https://github.com/prisma/prisma/issues/5596) · [#29024](https://github.com/prisma/prisma/issues/29024) ·
  [#29064](https://github.com/prisma/prisma/issues/29064) · [#29870](https://github.com/prisma/prisma/issues/29870) ·
  [#29933](https://github.com/prisma/prisma/issues/29933) · [#30028](https://github.com/prisma/prisma/issues/30028) ·
  [#28209](https://github.com/prisma/prisma/issues/28209) · [#2955](https://github.com/prisma/prisma/issues/2955) ·
  [#26609 fake timers](https://github.com/prisma/prisma/issues/26609) ·
  [#27627 `index-browser.js`](https://github.com/prisma/prisma/issues/27627) ·
  [#18577 segfault under Vitest](https://github.com/prisma/prisma/issues/18577) ·
  [#22292 coverage](https://github.com/prisma/prisma/issues/22292) · [#28105 WASM/Vite](https://github.com/prisma/prisma/issues/28105)

---

## What this means for TicketDesk

**Direct input to *Decide: Prisma 6 or Prisma 7 with a driver adapter* (#19).** The two generations differ on exactly the
axes a Vitest + SQLite suite depends on — pool behaviour, an open segfault, and how the CLI resolves `DATABASE_URL` —
and nothing in this repo pins a major version.

**Direct input to *Decide: test-database isolation for Prisma + SQLite under Vitest* (#14), now resolved.** That ticket
chose a migrated template database copied once per test file, built by `prisma migrate deploy`, with `DATABASE_URL`
overridden in process and `resetDb()` deleting in dependency order. Three findings here are load-bearing for it:

1. **The in-memory option was never available** (§1), which removed the only alternative to a file-backed database.
2. **A plain file copy is safe because WAL is off** (§5) — but that safety is a property of Prisma's current behaviour,
   not a guarantee, so the setup asserts `journal_mode` rather than assuming it.
3. **Deleting in dependency order is the only version-independent reset** (§6) — `PRAGMA foreign_keys = OFF` is a no-op
   inside a transaction and unreliable under the v6 pool.

**One version-conditional line remains in that resolution:** whether the test URL needs `?connection_limit=1`, which
depends on the answer to the version ticket. Under Prisma 7 that parameter would not just be unnecessary — it would
become part of the database filename (§2).
