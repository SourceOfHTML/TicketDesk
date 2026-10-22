import { Controller, Post } from '@nestjs/common';
import { signupSchema, type SignupInput, type UserSummary } from '@ticketdesk/shared';
import { ZodBody } from '../validation/zod-param.decorators';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@ZodBody(signupSchema) input: SignupInput): Promise<UserSummary> {
    return this.authService.signup(input);
  }
}
