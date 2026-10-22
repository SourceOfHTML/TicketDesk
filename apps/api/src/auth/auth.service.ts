import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  userSummarySchema,
  type LoginInput,
  type SignupInput,
  type UserSummary,
} from '@ticketdesk/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';
import { generateSessionToken, sessionExpiry } from './session-cookie';

export interface StartedSession {
  user: UserSummary;
  token: string;
}

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

  async login({ email, password }: LoginInput): Promise<StartedSession> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // One message for both failures: whether the address exists is not the
    // caller's business.
    if (user === null || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = generateSessionToken();
    await this.prisma.session.create({
      data: { id: token, userId: user.id, expiresAt: sessionExpiry() },
    });

    return { user: userSummarySchema.parse(user), token };
  }

  /**
   * Revocation is a delete, not an expiry mark. `deleteMany` keeps a repeat
   * sign-out (two tabs, say) a no-op rather than a 404.
   */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }
}
