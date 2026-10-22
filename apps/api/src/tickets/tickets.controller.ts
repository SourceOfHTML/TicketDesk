import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ticketListQuerySchema, type Ticket, type TicketListQuery } from '@ticketdesk/shared';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { ZodQuery } from '../validation/zod-param.decorators';
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
}
