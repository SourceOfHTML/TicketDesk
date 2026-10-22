import type { ValidationIssueLike } from '@ticketdesk/shared';

/**
 * The only surface this app uses of a shared schema. Zod's `ZodType` satisfies it
 * structurally, so the API never imports Zod itself.
 */
export interface RequestSchema<T = unknown> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly ValidationIssueLike[] } };
}
