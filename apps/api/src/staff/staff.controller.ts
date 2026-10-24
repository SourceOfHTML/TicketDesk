import { Controller, Get, UseGuards } from '@nestjs/common';
import type { UserRef } from '@ticketdesk/shared';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { StaffService } from './staff.service';

/** Staff only: the directory names every Staff member, so Requesters may not read it. */
@Controller('staff')
@UseGuards(SessionGuard, RolesGuard)
@Roles('STAFF')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  list(): Promise<UserRef[]> {
    return this.staffService.list();
  }
}
