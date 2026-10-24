import { Injectable } from '@nestjs/common';
import { userRefSchema, type UserRef } from '@ticketdesk/shared';
import { PrismaService } from '../prisma/prisma.service';
import { USER_REF } from '../users/user-ref';

/** The directory of Staff, for the assignee picker and filter. */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every Staff member as a summary — never a whole User. Ordered by email so
   * the picker does not reshuffle between visits.
   */
  async list(): Promise<UserRef[]> {
    const staff = await this.prisma.user.findMany({
      where: { role: 'STAFF' },
      select: USER_REF,
      orderBy: { email: 'asc' },
    });

    return staff.map((member) => userRefSchema.parse(member));
  }
}
