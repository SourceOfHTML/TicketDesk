import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  createCommentSchema,
  createTicketSchema,
  ticketListQuerySchema,
  ticketParamsSchema,
  updateAssigneeSchema,
  updatePrioritySchema,
  type Comment,
  type CreateCommentInput,
  type CreateTicketInput,
  type Ticket,
  type TicketDetail,
  type TicketListQuery,
  type TicketParams,
  type UpdateAssigneeInput,
  type UpdatePriorityInput,
} from '@ticketdesk/shared';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { ZodBody, ZodParam, ZodQuery } from '../validation/zod-param.decorators';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@UseGuards(SessionGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @ZodBody(createTicketSchema) input: CreateTicketInput,
  ): Promise<Ticket> {
    return this.ticketsService.create(request.user, input);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @ZodQuery(ticketListQuerySchema) filter: TicketListQuery,
  ): Promise<Ticket[]> {
    return this.ticketsService.list(request.user, filter);
  }

  @Get(':id')
  detail(
    @Req() request: AuthenticatedRequest,
    @ZodParam(ticketParamsSchema) params: TicketParams,
  ): Promise<TicketDetail> {
    return this.ticketsService.detail(request.user, params.id);
  }

  /** Staff only: correcting the Requester's Priority assessment. */
  @Patch(':id/priority')
  @UseGuards(RolesGuard)
  @Roles('STAFF')
  updatePriority(
    @ZodParam(ticketParamsSchema) params: TicketParams,
    @ZodBody(updatePrioritySchema) input: UpdatePriorityInput,
  ): Promise<Ticket> {
    return this.ticketsService.updatePriority(params.id, input);
  }

  /** Staff only: naming the Assignee, or leaving the Ticket unassigned. */
  @Patch(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('STAFF')
  updateAssignee(
    @ZodParam(ticketParamsSchema) params: TicketParams,
    @ZodBody(updateAssigneeSchema) input: UpdateAssigneeInput,
  ): Promise<Ticket> {
    return this.ticketsService.updateAssignee(params.id, input);
  }

  @Post(':id/comments')
  createComment(
    @Req() request: AuthenticatedRequest,
    @ZodParam(ticketParamsSchema) params: TicketParams,
    @ZodBody(createCommentSchema) input: CreateCommentInput,
  ): Promise<Comment> {
    return this.ticketsService.createComment(request.user, params.id, input);
  }
}
