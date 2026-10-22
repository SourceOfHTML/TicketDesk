import { z } from 'zod';

// SQLite has no enum type (ADR-0003); these are the only guarantees of the legal values.
export const prioritySchema = z.enum(['low', 'medium', 'high']);
export type Priority = z.infer<typeof prioritySchema>;

export const statusSchema = z.enum(['open', 'in-progress', 'resolved', 'closed']);
export type Status = z.infer<typeof statusSchema>;

/** The shape every response uses wherever it names a User: a summary, never an entity. */
export const userRefSchema = z.object({
  id: z.string(),
  email: z.email(),
});
export type UserRef = z.infer<typeof userRefSchema>;

export const ticketSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: prioritySchema,
  status: statusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  creator: userRefSchema,
  assignee: userRefSchema.nullable(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/**
 * `?status=open,closed` — one parameter, several chosen values. Each value is
 * parsed by the item schema, and its issue is re-emitted at the parameter's own
 * path, so a bad value reads as `status: …` rather than `status.0: …`.
 */
function commaSeparated<T extends z.ZodType>(item: T) {
  return z.string().transform((raw, ctx): z.output<T>[] => {
    const values: z.output<T>[] = [];

    for (const part of raw.split(',')) {
      const result = item.safeParse(part);

      if (!result.success) {
        // Re-added as custom issues so they land on the parameter's own path;
        // the item's wording is kept as-is.
        for (const issue of result.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message });
        }
        return z.NEVER;
      }

      values.push(result.data);
    }

    return values;
  });
}

export const ticketListQuerySchema = z.strictObject({
  status: commaSeparated(statusSchema).optional(),
  priority: commaSeparated(prioritySchema).optional(),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/**
 * The wire form of the filters — the inverse of `commaSeparated`. Both
 * directions of the query contract are defined here, so the browser cannot
 * drift from the schema the API enforces.
 */
export function ticketListQueryString(query: TicketListQuery): string {
  const params = new URLSearchParams();

  if (query.status !== undefined && query.status.length > 0) {
    params.set('status', query.status.join(','));
  }
  if (query.priority !== undefined && query.priority.length > 0) {
    params.set('priority', query.priority.join(','));
  }

  return params.toString();
}
