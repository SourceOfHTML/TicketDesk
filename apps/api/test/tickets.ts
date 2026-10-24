import type { INestApplication } from '@nestjs/common';
import type { Priority, Status } from '@ticketdesk/shared';
import type { CommentModel, StatusChangeModel, TicketModel } from '../src/generated/prisma/models';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TicketOverrides {
  /** Required: every Ticket has exactly one Requester, fixed at creation. */
  creatorId: string;
  assigneeId?: string | null;
  title?: string;
  description?: string;
  priority?: Priority;
  status?: Status;
  createdAt?: Date;
}

/**
 * A Ticket fixture built by construction: every default is a legal value, so a
 * test names only the field it is about. Direct Prisma writes, like every
 * fixture, so the test never depends on a route it is not testing.
 */
export function createTicket(
  app: INestApplication,
  overrides: TicketOverrides,
): Promise<TicketModel> {
  return app.get(PrismaService).ticket.create({
    data: {
      title: 'A ticket',
      description: 'Something is broken.',
      priority: 'medium',
      status: 'open',
      ...overrides,
    },
  });
}

export interface CommentOverrides {
  ticketId: string;
  authorId: string;
  body?: string;
  createdAt?: Date;
}

/** A Comment fixture, built the same way as a Ticket: valid by construction. */
export function createComment(
  app: INestApplication,
  overrides: CommentOverrides,
): Promise<CommentModel> {
  return app.get(PrismaService).comment.create({
    data: { body: 'Any news?', ...overrides },
  });
}

export interface StatusChangeOverrides {
  ticketId: string;
  changedById: string;
  fromStatus?: Status;
  toStatus?: Status;
  reason?: string | null;
  createdAt?: Date;
}

/** A Status Change fixture; creation is deliberately not a Status Change. */
export function createStatusChange(
  app: INestApplication,
  overrides: StatusChangeOverrides,
): Promise<StatusChangeModel> {
  return app.get(PrismaService).statusChange.create({
    data: { fromStatus: 'open', toStatus: 'in-progress', reason: null, ...overrides },
  });
}
