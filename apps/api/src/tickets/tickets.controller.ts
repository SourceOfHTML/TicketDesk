import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  createTicketSchema,
  ticketListQuerySchema,
  ticketParamsSchema,
  type CreateTicketInput,
  type Ticket,
  type TicketDetail,
  type TicketListQuery,
  type TicketParams,
} from '@ticketdesk/shared';
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
}
