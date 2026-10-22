import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@ticketdesk/shared';
import type { AuthenticatedRequest } from './session.guard';

export const ROLES_KEY = 'roles';

/** Declares who a route is for. Always paired with `SessionGuard`. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Returns 403 when the authenticated caller lacks a declared Role. It never
 * resolves identity: without `SessionGuard` there is no user, and a route that
 * forgot it fails loudly rather than passing.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>();

    if (request.user === undefined || !required.includes(request.user.role)) {
      throw new ForbiddenException('Staff only');
    }

    return true;
  }
}
