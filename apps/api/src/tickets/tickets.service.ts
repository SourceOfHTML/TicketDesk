import { Injectable } from '@nestjs/common';
import {
  ticketSchema,
  type Ticket,
  type TicketListQuery,
  type UserSummary,
} from '@ticketdesk/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** User summaries carry these fields and no others — never a password hash. */
const USER_REF = { id: true, email: true } as const;

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A Requester's view is their own Tickets; Staff reach every Ticket. The
   * filter is applied in the query, never after it (spec: visibility).
   */
  async list(user: UserSummary, { status, priority }: TicketListQuery): Promise<Ticket[]> {
    const where: Prisma.TicketWhereInput = {
      ...(user.role === 'STAFF' ? {} : { creatorId: user.id }),
      ...(status === undefined ? {} : { status: { in: status } }),
      ...(priority === undefined ? {} : { priority: { in: priority } }),
    };

    const tickets = await this.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: USER_REF }, assignee: { select: USER_REF } },
    });

    return tickets.map((ticket) =>
      ticketSchema.parse({
        ...ticket,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      }),
    );
  }
}
