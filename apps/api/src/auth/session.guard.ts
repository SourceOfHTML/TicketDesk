import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { userSummarySchema, type UserSummary } from '@ticketdesk/shared';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  clearedSessionCookie,
  readSessionToken,
  sessionCookie,
  sessionExpiry,
} from './session-cookie';

export interface AuthenticatedRequest extends Request {
  user: UserSummary;
  sessionId: string;
}

/**
 * The only layer that resolves a cookie to a session, and the only one that
 * writes one (ADR-0002). An authenticated request slides the row and re-issues
 * the cookie; an absent, unknown or expired token is refused and cleared, and
 * an expired row is left where it is.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const token = readSessionToken(request.headers.cookie);

    if (token === null) {
      throw refuse(response);
    }

    const session = await this.prisma.session.findUnique({
      where: { id: token },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (session === null || session.expiresAt.getTime() <= Date.now()) {
      throw refuse(response);
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: sessionExpiry() },
    });
    response.append('Set-Cookie', sessionCookie(session.id));

    const authenticated = request as AuthenticatedRequest;
    authenticated.user = userSummarySchema.parse(session.user);
    authenticated.sessionId = session.id;

    return true;
  }
}

function refuse(response: Response): UnauthorizedException {
  response.append('Set-Cookie', clearedSessionCookie());
  // The message is passed explicitly so Nest emits its full envelope —
  // `{ statusCode, message, error }` — and not just status and message.
  return new UnauthorizedException('Unauthorized');
}
