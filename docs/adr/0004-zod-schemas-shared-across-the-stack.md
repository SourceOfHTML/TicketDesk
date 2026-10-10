# Zod schemas shared between client and server

Validation is Zod, with one schema per input living in `packages/shared` and imported by both `apps/api` and `apps/web`. `z.infer` is the single source of the shape, so there are no hand-written parallel interfaces.

Nest's idiomatic choice is `class-validator` DTOs with its built-in `ValidationPipe`, and that would be less code. It was rejected because the requirement is that the client *may* validate while the server *absolutely must* — and one schema run on both sides satisfies both halves from a single definition, whereas class-validator DTOs exist only on the server and leave the client to re-implement the same limits in a second dialect that can silently drift.

That a Zod pipe sits in a Nest app reads as unremarkable, so nobody would guess this was a departure from the framework's default. It is recorded because it is one, and because it carries a cost: the pipe is hand-written, and third-party Zod/Nest integration packages are deliberately not used.

## Consequences

- Adding or changing a field's rules happens in exactly one place, for both sides at once.
- The server must still run the schema itself. Sharing it with the client is an ergonomic win, never a reason to trust the client's result.
