import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ticketListQuerySchema,
  ticketParamsSchema,
  type Ticket,
  type TicketDetail,
  type TicketListQuery,
  type TicketParams,
} from '@ticketdesk/shared';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { ZodParam, ZodQuery } from '../validation/zod-param.decorators';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@UseGuards(SessionGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @ZodQuery(ticketListQuerySchema) filter: TicketListQuery,
  ): Promise<Ticket[]> {
    return this.ticketsService.list(request.user, filter);
  }

  @Get(':id')
  get(
    @Req() request: AuthenticatedRequest,
    @ZodParam(ticketParamsSchema) params: TicketParams,
  ): Promise<TicketDetail> {
    return this.ticketsService.get(request.user, params.id);
  }
}
