import type { INestApplication } from '@nestjs/common';
import type { Priority, Status } from '@ticketdesk/shared';
import type { TicketModel } from '../src/generated/prisma/models';
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
