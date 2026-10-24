/**
 * The one projection of a User any response may carry: `{ id, email }`. It is a
 * select rather than a delete, so `passwordHash` is absent by construction
 * rather than by remembering to omit it.
 */
export const USER_REF = { id: true, email: true } as const;
