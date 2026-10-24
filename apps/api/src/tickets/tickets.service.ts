import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  UNASSIGNED_ASSIGNEE,
  commentSchema,
  ticketDetailSchema,
  ticketSchema,
  type Comment,
  type CreateCommentInput,
  type CreateTicketInput,
  type Ticket,
  type TicketDetail,
  type TicketListQuery,
  type UpdateAssigneeInput,
  type UpdatePriorityInput,
  type UserSummary,
} from '@ticketdesk/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { USER_REF } from '../users/user-ref';

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
  async list(
    user: UserSummary,
    { status, priority, assigneeId }: TicketListQuery,
  ): Promise<Ticket[]> {
    const isStaff = user.role === 'STAFF';

    // `assigneeId` is Staff-only. Refused, not ignored: a Requester who asks to
    // filter by Assignee is told so rather than handed an unfiltered list.
    if (assigneeId !== undefined && !isStaff) {
      throw new ForbiddenException('Staff only');
    }

    // The Assignee filter is an "any of these" over Staff, with `unassigned`
    // asking for the Tickets nobody owns. Choosing several keeps that OR, so a
    // combination is never read as "assigned to X and unowned at once".
    const assigneeIds = assigneeId?.filter((value) => value !== UNASSIGNED_ASSIGNEE);
    const assigneeFilters: Prisma.TicketWhereInput[] = [];

    if (assigneeIds !== undefined && assigneeIds.length > 0) {
      assigneeFilters.push({ assigneeId: { in: assigneeIds } });
    }
    if (assigneeId?.includes(UNASSIGNED_ASSIGNEE) === true) {
      assigneeFilters.push({ assigneeId: null });
    }

    const where: Prisma.TicketWhereInput = {
      ...(isStaff ? {} : { creatorId: user.id }),
      ...(status === undefined ? {} : { status: { in: status } }),
      ...(priority === undefined ? {} : { priority: { in: priority } }),
      ...(assigneeFilters.length === 0 ? {} : { OR: assigneeFilters }),
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

    this.assertVisible(user, ticket);

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

    this.assertVisible(user, ticket);

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

  /** Staff correct the Requester's assessment; nothing else about the Ticket moves. */
  async updatePriority(id: string, input: UpdatePriorityInput): Promise<Ticket> {
    await this.assertExists(id);

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: { priority: input.priority },
      include: TICKET_INCLUDE,
    });

    return toTicket(ticket);
  }

  /**
   * Only Staff own work: an Assignee that names a USER, or no User at all, is
   * a bad request. Unassigning is a legitimate state, hence `null`.
   */
  async updateAssignee(id: string, input: UpdateAssigneeInput): Promise<Ticket> {
    await this.assertExists(id);

    if (input.assigneeId !== null) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: input.assigneeId },
        select: { role: true },
      });

      if (assignee === null || assignee.role !== 'STAFF') {
        throw new BadRequestException('Assignee must be Staff');
      }
    }

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: { assigneeId: input.assigneeId },
      include: TICKET_INCLUDE,
    });

    return toTicket(ticket);
  }

  /** An absent Ticket is a 404 on every route that names one. */
  private async assertExists(id: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, select: { id: true } });

    if (ticket === null) {
      throw new NotFoundException('Ticket not found');
    }
  }

  /** The one visibility rule: a Ticket's Requester or any Staff member. */
  private assertVisible(user: UserSummary, ticket: { creatorId: string }): void {
    if (user.role !== 'STAFF' && ticket.creatorId !== user.id) {
      throw new ForbiddenException('Forbidden');
    }
  }
}
