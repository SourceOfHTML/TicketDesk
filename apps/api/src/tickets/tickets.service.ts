import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  commentSchema,
  ticketDetailSchema,
  ticketSchema,
  type Comment,
  type CreateCommentInput,
  type CreateTicketInput,
  type Ticket,
  type TicketDetail,
  type TicketListQuery,
  type UserSummary,
} from '@ticketdesk/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** User summaries carry these fields and no others — never a password hash. */
const USER_REF = { id: true, email: true } as const;

/** Every Ticket response embeds its Requester and Assignee, never whole Users. */
const TICKET_INCLUDE = { creator: { select: USER_REF }, assignee: { select: USER_REF } } as const;

/** One Ticket's wire shape, whether it came from a list, a create or a detail. */
function toTicket(ticket: Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>): Ticket {
  return ticketSchema.parse({
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  });
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Raising a Ticket never writes a Status Change: a new Ticket is `open` by
   * definition, and `createdAt` already records when. Its Requester is the
   * caller, whichever Role they hold.
   */
  async create(user: UserSummary, input: CreateTicketInput): Promise<Ticket> {
    const ticket = await this.prisma.ticket.create({
      data: {
        title: input.title,
        description: input.description,
        priority: input.priority,
        status: 'open',
        creatorId: user.id,
      },
      include: TICKET_INCLUDE,
    });

    return toTicket(ticket);
  }

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
      include: TICKET_INCLUDE,
    });

    return tickets.map(toTicket);
  }

  /**
   * One Ticket with both of its threads, ascending. Missing authorization is a
   * 403, never a 404 — only an absent Ticket is a 404, which is why the lookup
   * happens before the Requester check.
   */
  async detail(user: UserSummary, id: string): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...TICKET_INCLUDE,
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
      ...toTicket(ticket),
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

  /** A Comment is written once; there is no edit or delete path to balance it. */
  async createComment(
    user: UserSummary,
    ticketId: string,
    input: CreateCommentInput,
  ): Promise<Comment> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { creatorId: true, status: true },
    });

    if (ticket === null) {
      throw new NotFoundException('Ticket not found');
    }

    if (user.role !== 'STAFF' && ticket.creatorId !== user.id) {
      throw new ForbiddenException('Forbidden');
    }

    // `closed` is the end of a Ticket's life; `resolved` only pauses it. The
    // composer's absence is a courtesy — this is the enforcement.
    if (ticket.status === 'closed') {
      throw new ForbiddenException('This ticket is closed.');
    }

    const comment = await this.prisma.comment.create({
      data: { ticketId, authorId: user.id, body: input.body },
      include: { author: { select: USER_REF } },
    });

    return commentSchema.parse({ ...comment, createdAt: comment.createdAt.toISOString() });
  }
}
