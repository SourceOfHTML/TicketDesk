import { BadRequestException, Injectable } from '@nestjs/common';
import { userSummarySchema, type SignupInput, type UserSummary } from '@ticketdesk/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signup({ email, password }: SignupInput): Promise<UserSummary> {
    const passwordHash = await hashPassword(password);

    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash, role: 'USER' },
        select: { id: true, email: true, role: true },
      });

      return userSummarySchema.parse(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('email: An account with this email already exists');
      }
      throw error;
    }
  }
}
