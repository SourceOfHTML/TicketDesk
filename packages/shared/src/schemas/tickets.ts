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

/** A Comment is written once and never altered; its author is a summary. */
export const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  author: userRefSchema,
});
export type Comment = z.infer<typeof commentSchema>;

/** One move in a Ticket's audit trail: who moved it, when, and why. */
export const statusChangeSchema = z.object({
  id: z.string(),
  fromStatus: statusSchema,
  toStatus: statusSchema,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  changedBy: userRefSchema,
});
export type StatusChange = z.infer<typeof statusChangeSchema>;

/** The detail response: the Ticket plus both of its threads, each ascending. */
export const ticketDetailSchema = ticketSchema.extend({
  comments: z.array(commentSchema),
  statusChanges: z.array(statusChangeSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

/**
 * Raising a Ticket. Title and description are required and bounded; the
 * Requester chooses the Priority, and everything else about the new Ticket is
 * fixed by the act of raising it.
 */
export const createTicketSchema = z.strictObject({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(10_000),
  priority: prioritySchema,
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/**
 * Posting a Comment. The body is the whole Comment: who wrote it and when is
 * fixed by the act of posting it, and a Comment is never edited or deleted.
 */
export const createCommentSchema = z.strictObject({
  body: z.string().min(1).max(10_000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/**
 * A Staff member's correction of the Requester's assessment. Priority is set at
 * creation by the Requester and changed only here; the Ticket is otherwise
 * immutable.
 */
export const updatePrioritySchema = z.strictObject({
  priority: prioritySchema,
});
export type UpdatePriorityInput = z.infer<typeof updatePrioritySchema>;

/**
 * Assigning a Ticket to Staff, or `null` to leave it unassigned. Whether the
 * named User is Staff is the domain's question, not the schema's.
 */
export const updateAssigneeSchema = z.strictObject({
  assigneeId: z.string().min(1).nullable(),
});
export type UpdateAssigneeInput = z.infer<typeof updateAssigneeSchema>;

/**
 * Moving a Ticket's Status. Which moves are legal — and whether the reason is
 * required — is the domain's question, not the schema's. Only its length is
 * here, because a Status Change stores it.
 */
export const updateStatusSchema = z.strictObject({
  status: statusSchema,
  reason: z.string().max(2_048).optional(),
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

/** Any string is a well-formed id; an unknown one is a 404 from the service. */
export const ticketParamsSchema = z.strictObject({
  id: z.string().min(1),
});
export type TicketParams = z.infer<typeof ticketParamsSchema>;

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

/**
 * The one `assigneeId` value that is not a User id: the Tickets no Staff member
 * owns. It rides in the same comma-separated list, so one multi-select can ask
 * for some Staff and the unowned Tickets together.
 */
export const UNASSIGNED_ASSIGNEE = 'unassigned';

export const ticketListQuerySchema = z.strictObject({
  status: commaSeparated(statusSchema).optional(),
  priority: commaSeparated(prioritySchema).optional(),
  /** Staff only: a Requester who supplies it is refused by the API, not ignored. */
  assigneeId: commaSeparated(z.string().min(1)).optional(),
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
  if (query.assigneeId !== undefined && query.assigneeId.length > 0) {
    params.set('assigneeId', query.assigneeId.join(','));
  }

  return params.toString();
}
