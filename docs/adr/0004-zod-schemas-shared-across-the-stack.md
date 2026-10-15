# Zod schemas shared between client and server

Validation is Zod, with one schema per input living in `packages/shared` and imported by both `apps/api` and `apps/web` — request bodies, query strings, and route params alike. `z.infer` is the single source of the shape, so there are no hand-written parallel interfaces.

Nest's idiomatic choice is `class-validator` DTOs with its built-in `ValidationPipe`, and that would be less code. It was rejected because the requirement is that the client *may* validate while the server *absolutely must* — and one schema run on both sides satisfies both halves from a single definition, whereas class-validator DTOs exist only on the server and leave the client to re-implement the same limits in a second dialect that can silently drift.

**Amended 2026-10-15, when the enforcement mechanism was settled.** This ADR originally read *"Nest has no native Zod support"*. That was true when it was written and is not any more: Nest 12 ships first-class Standard Schema support — `@Body({ schema })` with `StandardSchemaValidationPipe` — whose default error body is exactly the shape this project requires. The pipe is therefore hand-written **on purpose** rather than for want of an option: this is a learning exercise whose point is the mechanism, and a hand-rolled pipe is also the only variant that can fail loudly when a route forgets its schema. Third-party Zod/Nest integration packages remain rejected, now on measured grounds rather than by preference — `nestjs-zod` declares no Nest 12 peer, and its error body misses the required contract on all three points. If this ever stops being a learning exercise, take the built-in pipe.

## Consequences

- Adding or changing a field's rules happens in exactly one place, for both sides at once.
- The server must still run the schema itself. Sharing it with the client is an ergonomic win, never a reason to trust the client's result.
- Query and route-param schemas are shared too, so `apps/web` imports a comma-splitting transform it never runs. Accepted: one registry beats a per-schema judgment call about which app owns it.
- The hand-rolled pipe deliberately reimplements something Nest 12 now ships. It is the first thing to delete if the learning stops being the point.
