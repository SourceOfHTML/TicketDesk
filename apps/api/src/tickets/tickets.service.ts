import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ticketDetailSchema,
  ticketSchema,
  type Ticket,
  type TicketDetail,
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

  /**
   * One Ticket with both of its threads, ascending. Missing authorization is a
   * 403, never a 404 — only an absent Ticket is a 404, which is why the lookup
   * happens before the ownership check.
   */
  async get(user: UserSummary, id: string): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        creator: { select: USER_REF },
        assignee: { select: USER_REF },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: USER_REF } },
        },
        statusChanges: {
          orderBy: { createdAt: 'asc' },
          include: { changedBy: { select: USER_REF } },
        },
      },
    });

    if (ticket === null) {
      throw new NotFoundException('Ticket not found');
    }

    if (user.role !== 'STAFF' && ticket.creatorId !== user.id) {
      throw new ForbiddenException('Forbidden');
    }

    return ticketDetailSchema.parse({
      ...ticket,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      comments: ticket.comments.map((comment) => ({
        ...comment,
        createdAt: comment.createdAt.toISOString(),
      })),
      statusChanges: ticket.statusChanges.map((change) => ({
        ...change,
        createdAt: change.createdAt.toISOString(),
      })),
    });
  }
}
