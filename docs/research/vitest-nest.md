# Running Vitest against a NestJS application

**Status:** research findings, verified empirically against a scratch NestJS 12 project plus primary sources.
**Question:** How do you run Vitest against a NestJS application? Specifically: does Vitest's default transform emit
`emitDecoratorMetadata`, and what happens when it does not?

---

## TL;DR

1. **Vitest's default transform is not stable across versions, and that is the whole story.** Vitest delegates
   TypeScript transpilation to **Vite**, which switched its transformer from **esbuild** to **Oxc** in **Vite 8**.
   - **Vite ≤ 7 (esbuild):** decorator metadata is *never* emitted. NestJS DI breaks.
   - **Vite 8 (Oxc):** decorator metadata *is* emitted, as long as `emitDecoratorMetadata: true` is in the tsconfig
     that Vite reads for the file. NestJS DI works out of the box — **no `unplugin-swc` needed.**
2. **The failure is exactly as suspected: silent, and it masquerades as an ordinary bug in application code.**
   `Test.createTestingModule(...).compile()` **succeeds**. Nest constructs the class with **zero arguments**, so the
   injection site is `undefined`, and the error surfaces later as a plain `TypeError` pointing at *your* controller:
   ```
   TypeError: Cannot read properties of undefined (reading 'getHello')
    ❯ AppController.getHello src/app.controller.ts:10:28
   ```
   It does **not** say "Nest can't resolve dependencies".
3. **Recommendation for TicketDesk: pin Vite 8 (default with Vitest 5) and make sure `emitDecoratorMetadata: true`
   is in the tsconfig Vite reads.** Add `unplugin-swc` only if you are forced onto Vite ≤ 7.

---

## 1. What the default transform actually is

Vitest does not compile TypeScript itself. It reuses Vite's transform pipeline (["Vitest will read it to match with the
plugins and setup as your Vite app"](https://vitest.dev/config/)), and Vite's transformer changed:

- Vite's TypeScript docs now attribute transpilation to the **Oxc Transformer** and state plainly that `emitDecoratorMetadata`
  **"is only partially supported. Full support requires type inference by the TypeScript compiler, which is not
  supported."** — [vite.dev/guide/features](https://vite.dev/guide/features#emitdecoratormetadata)
- Vite 8.3.4's own `package.json` depends on **`rolldown`** and `lightningcss` — there is no esbuild dependency left.
- **esbuild** documents that `emitDecoratorMetadata` is **not supported at all**: decorator *syntax* works when
  `experimentalDecorators` is set, but the feature "does not support `emitDecoratorMetadata`" because it
  "passes a JavaScript representation of the corresponding TypeScript type to the attached decorator function" and
  esbuild "does not have enough information to implement this feature."
  — [esbuild.github.io/content-types/#typescript](https://esbuild.github.io/content-types/#typescript)

**Version boundary (measured):** Vitest 5's peer range is `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`, so Vitest 5 can still be
resolved onto Vite 7. Vitest 4.1.11 resolved to Vite 8.3.4 in a clean install. **Which transformer you get is
determined by the installed `vite` version, not the `vitest` version.** Note also that in Vitest 5, `vite` is no longer
a direct dependency — it is a **required peer dependency**, so it must be listed in `package.json`
([migration guide](https://vitest.dev/guide/migration)).

---

## 2. The failure mode, reproduced

Scratch project: NestJS 12, `@nestjs/testing`, `emitDecoratorMetadata: true` and `experimentalDecorators: true` in
`tsconfig.json`, test:

```ts
const moduleRef = await Test.createTestingModule({
  controllers: [AppController],
  providers: [AppService],
}).compile();

const controller = moduleRef.get(AppController);
expect(controller.getHello()).toBe('hello from service');
```

where `AppController` is `constructor(private readonly appService: AppService) {}`.

### Matrix of results (all measured)

| Transform | Versions | `design:paramtypes` emitted? | Result |
| --- | --- | --- | --- |
| Oxc | vitest 5.0.3 + vite 8.3.4 | yes | **passes** |
| Oxc | vitest 4.1.11 + vite 8.3.4 | yes | **passes** |
| Oxc, `emitDecoratorMetadata: false` | vitest 5.0.3 + vite 8.3.4 | no | **fails**, `TypeError` |
| esbuild | vitest 4.1.11 + vite 7.3.7 | no | **fails**, `TypeError` |
| `unplugin-swc` | vitest 4.1.11 + vite 7.3.7 | yes | **passes** |
| `unplugin-swc` | vitest 5.0.3 + vite 8.3.4 | yes | **passes** |
| bare esbuild 0.28.2 | — | no | n/a |

Bare esbuild output for a decorated controller contains `__decorateClass(...)` but **no** `__metadata("design:paramtypes", …)`
and no `Reflect.metadata` reference at all.

### The actual error

```
 FAIL  test/di.spec.ts > Nest DI > injects AppService into AppController via type metadata
TypeError: Cannot read properties of undefined (reading 'getHello')
 ❯ AppController.getHello src/app.controller.ts:10:28
      8|   @Get()
      9|   getHello(): string {
     10|     return this.appService.getHello();
       |                            ^
     11|   }
     12| }
 ❯ test/di.spec.ts:14:23
```

**This confirms the suspicion in the ticket.** Two properties make it a masquerade:

- `compile()` does not throw. There is no dependency-resolution error. The module "successfully" builds.
- The stack trace's first frame is *application code*, so the failure reads as a bug in `AppController`, not as a
  configuration problem.

### Why it is silent — from Nest's own source

`@nestjs/core/injector/injector.js` resolves constructor dependencies like this:

```js
reflectConstructorParams(type) {
    const paramtypes = [
        ...(Reflect.getMetadata(PARAMTYPES_METADATA, type) || []),
    ];
    const selfParams = this.reflectSelfParams(type);
    selfParams.forEach(({ index, param }) => (paramtypes[index] = param));
    return Array.from(paramtypes);
}
```

`PARAMTYPES_METADATA` is `'design:paramtypes'`. When the metadata is absent the `|| []` fallback yields an **empty
array**, so Nest concludes the constructor takes no parameters and instantiates it with zero arguments. There is no
fallback to parameter-name inference. `resolveSingleParam` only throws `UndefinedDependencyException` when a param
*slot* exists but is itself `undefined` — which never happens here.

This is the mechanism behind the widely-reported symptom, e.g.
[nestjs/nest#17047 — "Bug: Dependency injection fails in TestingModule when using Vitest"](https://github.com/nestjs/nest/issues/17047):
*"The injected service becomes `undefined`, causing tests to fail with `TypeError: Cannot read properties of undefined`"*
with the workarounds `@Inject(AppService)` or `useValue`.

---

## 3. The working configuration

### 3a. Recommended — Vite 8 / Oxc, no plugin

```bash
npm i -D vitest @vitest/coverage-v8 vite
```

`vite.config.ts` / `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
  },
  resolve: {
    // Vitest does NOT read tsconfig `paths`; aliases must be declared here.
    alias: {
      src: resolve(import.meta.dirname, './src'),
    },
  },
});
```

`tsconfig.json` — the minimum that matters:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "isolatedModules": true,
    "module": "ES2022",
    "moduleResolution": "bundler",
    "target": "ES2022"
  }
}
```

This is corroborated by the NestJS maintainer in
[nestjs/nest#17047](https://github.com/nestjs/nest/issues/17047) — Kamil Myśliwiec: *"Have you tried with the latest
version of vitest (with oxc compiler instead of swc)? it should work ootb"*, and a reporter confirming *"am using
vitest 4 with vite 8 and it works fine … (note that I do not use the swc plugin)"*.

### 3b. Fallback — only if pinned to Vite ≤ 7

```bash
npm i -D unplugin-swc @swc/core
```

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { globals: true, root: './' },
});
```

This is the config from Nest's own [SWC recipe](https://docs.nestjs.com/recipes/swc#vitest). Measured: it turns the
Vite 7 failure into a pass. `unplugin-swc` reads `emitDecoratorMetadata` and `experimentalDecorators` from
`tsconfig.json` (configurable via `tsconfigFile`, default `./tsconfig.json`) and maps them to SWC's
`jsc.transform.decoratorMetadata` / `legacyDecorator`; it also disables esbuild for Vite. If you set decorators via
`.swcrc` instead, use `legacyDecorator: true` + `decoratorMetadata: true` under `jsc.transform`
([Nest SWC recipe](https://docs.nestjs.com/recipes/swc), [unplugin-swc README](https://github.com/unplugin/unplugin-swc)).

### 3c. Do you need the plugin on Vite 8?

No. Measured metadata output was **byte-for-byte equivalent** between the Oxc path and the `unplugin-swc` path for
every shape tested, and `unplugin-swc`'s README notes it automatically turns esbuild off — on Vite 8 you are replacing
one metadata emitter with another for no functional gain.

### 3d. e2e config

Keep e2e tests in a separate config, as Nest documents:

```ts
// vitest.config.e2e.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['**/*.e2e-spec.ts'], globals: true, root: './' },
});
```

**Gotcha (measured):** Vitest's default `include` is `['**/*.{test,spec}.?(c|m)[jt]s?(x)']`
([docs](https://vitest.dev/config/include)). `app.e2e-spec.ts` does **not** match it — the file was silently skipped
until an explicit `include` was added, so `vitest run` exits 0 while running nothing.

---

## 4. tsconfig settings, one at a time

| Option | Needed? | Notes |
| --- | --- | --- |
| `emitDecoratorMetadata` | **Required** | Without it Nest DI silently breaks (§2). Must be in the tsconfig the *transformer* reads. |
| `experimentalDecorators` | **Required** | Selects legacy decorators. Oxc/Vite list it under options that affect build output. |
| `isolatedModules` | Recommended, not required | Vite transpiles per-file with no type information. Measured: adding `isolatedModules: true` changed nothing (test still passed). Mainly a `tsc --noEmit` / `const enum` concern. |
| `emitDeclarationOnly` | **Irrelevant to Vitest** | Measured: setting `emitDeclarationOnly: true` + `declaration: true` alongside `emitDecoratorMetadata: true` had **no effect** — Vitest neither errors nor behaves differently. It only affects `tsc`. Vite ignores it. |
| `paths` | Not honoured at runtime | Vitest does not resolve tsconfig `paths`; declare `resolve.alias` instead. Nest's docs call this out explicitly ("Vitest doesn't automatically resolve TypeScript path aliases"). A `vite-tsconfig-paths`-style plugin also works. |

**The tsconfig you do not think about is the one that bites.** `unplugin-swc` reads `tsconfigFile` (default
`tsconfig.json`), while Vite/Oxc uses the nearest matching tsconfig per file (honouring `references`, `files`,
`include`, `exclude`). If the test-relevant tsconfig (e.g. `tsconfig.spec.json`, or `tsconfig.build.json` for a
project that excludes specs) lacks `emitDecoratorMetadata: true` and does not `extends` a config that sets it, you get
the §2 failure *with* a plugin apparently configured correctly.

---

## 5. Does it change `Test.createTestingModule` or `supertest`?

**`Test.createTestingModule` — no change at all.** The API, `.compile()`, `.overrideProvider()`, `.overrideGuard()`,
`moduleRef.get()` / `.resolve()`, `createNestApplication()` / `app.init()` / `app.close()` all behave identically. The
only difference is *which module instance* you import `Test` from on the mocking side: `import { vi } from 'vitest'`
instead of Jest's globals for spies (`vi.spyOn(catsService, 'findAll')`), which Nest's own testing docs now use
throughout.

**`supertest` — one required edit.** The namespace import is not callable under Vitest:

```ts
import * as request from 'supertest';  // ❌ TypeError: (0 , __vite_ssr_import_2__) is not a function
import request from 'supertest';       // ✅
```

Measured error for the namespace form: `TypeError: (0 , __vite_ssr_import_2__) is not a function` at the call site.
`supertest` is CJS exporting a function; a namespace import cannot be called in ESM. Everything else is unchanged —
`request(app.getHttpServer()).get('/').expect(200)` passes. Verified in this project by running a real
`app.init()` + supertest GET. Same guidance in the [Nest SWC recipe](https://docs.nestjs.com/recipes/swc#vitest).

**`reflect-metadata` — no explicit import needed.** Measured: a spec with no `import 'reflect-metadata'` passes,
because both `@nestjs/core` and `@nestjs/common` entry points already do `import 'reflect-metadata'`. Do not add a
`setupFiles` entry for it on the theory that Jest needed one.

---

## 6. Prisma's generated client under Vitest

TicketDesk uses Prisma + SQLite, and this is a real intersection.

- **Use the `prisma-client` generator, not `prisma-client-js`, if you generate to a custom `output`.** The
  `prisma-client-js` generator with a custom `output` resolves to **`index-browser.js`** under Vitest/Vite, producing
  `PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in Node.js)`
  — even with `environment: 'node'`. Prisma's maintainer states this is "solved with the new `prisma-client`
  generator" — [prisma/prisma#27627](https://github.com/prisma/prisma/issues/27627). Manual alias workarounds are
  explicitly discouraged in that thread.
- Prisma's official Vitest example is exactly our stack — **SQLite**, `provider = "prisma-client"`,
  `output = "../src/generated/prisma"` — and its `vitest.config.ts` needs **no swc plugin at all**:
  ```ts
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: { environment: 'node', globalSetup: './test/test-setup.ts' },
  })
  ```
  Its tsconfig sets `"moduleResolution": "bundler"` and `"isolatedModules": true`.
  — [prisma/prisma-examples `generator-prisma-client/vitest-esm-nodejs`](https://github.com/prisma/prisma-examples/tree/latest/generator-prisma-client/vitest-esm-nodejs)
- **`prisma generate` must run before the test command** — the generated client is gitignored build output. A
  `pretest` script or CI step is required.
- **Fake timers are incompatible.** `vi.useFakeTimers()` combined with Prisma queries hangs tests — open issue
  [prisma/prisma#26609](https://github.com/prisma/prisma/issues/26609), reproducible on Vitest 3.0.7 / Prisma 6.5.0.
  Prefer `vi.useFakeTimers({ toFake: [...] })` scoped away from DB calls, or keep such tests on real timers.
- `environment: 'node'` is already Vitest's default ([docs](https://vitest.dev/config/environment)), so it is
  belt-and-braces rather than a fix — it does **not** by itself cure the `index-browser.js` problem above.
- For mocking, the Jest-ecosystem `jest-mock-extended` does not apply directly; Prisma's own unit-testing guide is
  still Jest-only and never mentions Vitest
  ([Prisma unit testing docs](https://www.prisma.io/docs/orm/prisma-client/testing/unit-testing)). Use
  `vitest-mock-extended` as the direct analogue, or hand-rolled `vi.fn()` provider overrides.

---

## 7. Things that work in Jest but silently fail in Vitest

From Vitest's own [Migrating from Jest](https://vitest.dev/guide/migration/jest) guide, plus measured behaviour:

| Area | Jest | Vitest | Silent? |
| --- | --- | --- | --- |
| Globals | `describe`/`it`/`expect` global by default | **`globals: false` by default** | Yes — `ReferenceError: describe is not defined` (measured). Set `globals: true` or import from `vitest`. |
| Decorator metadata | ts-jest → tsc → metadata always emitted | Depends on Vite version (§1) | **Yes** — the §2 masquerade. |
| Path aliases | `moduleNameMapper` | `resolve.alias`; tsconfig `paths` **not** read | Yes — resolution errors at import. |
| e2e file naming | `testRegex: '.*\\.e2e-spec\\.ts$'` | default `include` misses `*.e2e-spec.ts` | **Yes** — zero tests run, exit 0 (measured). |
| `jest.mock` factory | returns the default export directly | must return an object with every export explicitly (`{ default: 'hello' }`) | Partial — confusing runtime shape errors. |
| `__mocks__` dirs | auto-applied | **not applied** unless `vi.mock()` is called | **Yes** — the real module is used and tests can still pass for the wrong reason. |
| `jest.requireActual` | — | `vi.importActual` | Explicit API break. |
| `jest.setTimeout` | — | `vi.setConfig({ testTimeout })` | Explicit API break. |
| Legacy fake timers | supported | **not supported** | Tests can hang rather than fail. |
| `jest` namespace types | `jest.Mock<T>` | `import type { Mock } from 'vitest'` | Compile-time. |
| Hook ordering | sequential | stack order by default — set `sequence: { hooks: 'list' }` | Yes — ordering bugs. |
| External-library mocking | extended by default | needs `server.deps.inline` | Yes. |
| `clearMocks` | `false` by default | **`true` by default in Vitest 5** | Yes — mock call history cleared before each test; set `clearMocks: false` to keep v4/Jest behaviour. |
| `JEST_WORKER_ID` | present | `VITEST_POOL_ID` / `VITEST_WORKER_ID` | Yes — env-dependent branches silently take another path. |
| `setupFilesAfterEnv` | — | `setupFiles` | Config rename. |

Also worth knowing: **`vi.spyOn` cannot replace exports of an ES module** the way Jest mutates CommonJS exports —
this affects SuperTest/`@nestjs`-style mocking patterns that relied on reassigning module properties.

---

## 8. A 60-second smoke test for DI metadata

Rather than debugging a confusing `TypeError` later, assert the metadata directly:

```ts
import 'reflect-metadata';
import { AppController } from '../src/app.controller';

it('emits decorator metadata for constructor injection', () => {
  const paramtypes = Reflect.getMetadata('design:paramtypes', AppController);
  expect(paramtypes).toBeDefined();
  expect(paramtypes.length).toBeGreaterThan(0);
});
```

If this fails, the transformer is the problem — not your application code. This is the single check that
distinguishes the §2 masquerade from a genuine bug.

---

## 9. Evidence and method

All behavioural claims above were reproduced in a scratch project (NestJS 12.1.2, `@nestjs/testing`, `reflect-metadata`,
supertest 7.3.1) at `/tmp/nestvit`, `/tmp/nestvit-esb` and `/tmp/esbtest`. Verified matrix:

- vitest 5.0.3 + vite 8.3.4 (Oxc): DI test passes, 3-level DI chain passes, supertest e2e passes.
- vitest 4.1.11 + vite 8.3.4 (Oxc): DI test passes.
- vitest 4.1.11 + vite 7.3.7 (esbuild): DI test **fails** with `TypeError: Cannot read properties of undefined`.
- Same project + `unplugin-swc`: DI test **passes**.
- `emitDecoratorMetadata: false` on Vite 8: DI test **fails** with the identical `TypeError`.
- bare esbuild 0.28.2 `transform()` on a decorated controller: no `design:paramtypes`, no `Reflect.metadata`.
- `isolatedModules: true` + `emitDeclarationOnly: true`: no behavioural change.
- `app.e2e-spec.ts` not matched by default `include`; matched once `include` is set.
- `import * as request from 'supertest'` → `TypeError: (0 , __vite_ssr_import_2__) is not a function`.

**Cross-checker caveat, stated honestly:** Oxc's docs advertise `emitDecoratorMetadata` as *partial*, falling back to
`Object` for types that "require type inference" ([Oxc transformer docs](https://oxc.rs/docs/guide/usage/transformer/typescript.html#decorators)).
I probed for a real divergence between Oxc, SWC and `tsc` and found **none** on the shapes tested — a directly-typed
class param, a generic class param, and a plain type alias (`type AliasService = RealService`) all produced identical
`design:paramtypes` under Oxc, `unplugin-swc`, tsc 5.9.3 and tsc 7.0.2 (the alias case emits `Object` under *all*
four, so it is a TypeScript-level behaviour, not a Vitest defect). Treat "partial" as a documented caveat rather than
an observed gap, but keep the §8 smoke test in the suite so a future Vite/Oxc change cannot reintroduce §2 silently.

---

## Sources

- [Vitest — Config reference](https://vitest.dev/config/) — Vitest reuses Vite's config and pipeline
- [Vitest — `include` config, default glob](https://vitest.dev/config/include)
- [Vitest — `globals` config, default `false`](https://vitest.dev/config/globals)
- [Vitest — `environment` config, default `'node'`](https://vitest.dev/config/environment)
- [Vitest — Migrating from Jest](https://vitest.dev/guide/migration/jest)
- [Vitest — Migrating to Vitest 5.0 (vite is a peer dependency; `clearMocks` default)](https://vitest.dev/guide/migration)
- [Vite — TypeScript features, `emitDecoratorMetadata` "only partially supported"](https://vite.dev/guide/features#emitdecoratormetadata)
- [esbuild — TypeScript content type, decorators and `emitDecoratorMetadata`](https://esbuild.github.io/content-types/#typescript)
- [Oxc Transformer — Decorators, legacy + `emitDecoratorMetadata`, `Object` fallback](https://oxc.rs/docs/guide/usage/transformer/typescript.html#decorators)
- [NestJS — SWC recipe, including the Vitest section](https://docs.nestjs.com/recipes/swc#vitest)
- [NestJS — Testing fundamentals (Vitest is the default for new ESM projects)](https://docs.nestjs.com/fundamentals/testing)
- [NestJS CLI overview — ESM defaults to Vitest, CommonJS to Jest](https://docs.nestjs.com/cli/overview)
- [nestjs/nest#17047 — DI fails in TestingModule under Vitest; resolved by Vitest 4 + Vite 8 + `emitDecoratorMetadata`](https://github.com/nestjs/nest/issues/17047)
- [TrilonIO/nest-vitest — reference repo linked from the Nest docs](https://github.com/TrilonIO/nest-vitest)
- [unplugin-swc README — tsconfig inference of `emitDecoratorMetadata`; esbuild disabled](https://github.com/unplugin/unplugin-swc)
- [prisma/prisma#27627 — `index-browser.js` under Vitest + SWC + custom output; fixed by the `prisma-client` generator](https://github.com/prisma/prisma/issues/27627)
- [prisma/prisma#26609 — Prisma Client incompatible with Vitest fake timers](https://github.com/prisma/prisma/issues/26609)
- [Prisma official example — `generator-prisma-client/vitest-esm-nodejs` (SQLite, no swc plugin)](https://github.com/prisma/prisma-examples/tree/latest/generator-prisma-client/vitest-esm-nodejs)
- [Prisma — Unit testing (Jest-only; no Vitest guidance)](https://www.prisma.io/docs/orm/prisma-client/testing/unit-testing)

## Addendum — Nest's own Vitest config, verbatim

For reference, from [docs.nestjs.com/recipes/swc](https://docs.nestjs.com/recipes/swc#vitest):

```ts
import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
  },
  plugins: [
    // This is required to build the test files with SWC
    swc.vite({
      // Explicitly set the module type to avoid inheriting this value from a `.swcrc` config file
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      // Ensure Vitest correctly resolves TypeScript path aliases
      'src': resolve(import.meta.dirname, './src'),
    },
  },
});
```

Nest's docs target the pre-Oxc world; on Vite 8 the `plugins` block is unnecessary. Keep the `resolve.alias` block —
it is still required on Vite 8, and dropping it is a separate, unrelated source of test failures.
