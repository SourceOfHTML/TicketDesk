import { Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  loginSchema,
  signupSchema,
  type LoginInput,
  type SignupInput,
  type UserSummary,
} from '@ticketdesk/shared';
import type { Response } from 'express';
import { ZodBody } from '../validation/zod-param.decorators';
import { AuthService } from './auth.service';
import { SessionGuard, type AuthenticatedRequest } from './session.guard';
import { clearedSessionCookie, sessionCookie } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(
    @ZodBody(signupSchema) input: SignupInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserSummary> {
    const { user, token } = await this.authService.signup(input);
    response.append('Set-Cookie', sessionCookie(token));
    return user;
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @ZodBody(loginSchema) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserSummary> {
    const { user, token } = await this.authService.login(input);
    response.append('Set-Cookie', sessionCookie(token));
    return user;
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest): UserSummary {
    return request.user;
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(request.sessionId);
    response.append('Set-Cookie', clearedSessionCookie());
  }
}
