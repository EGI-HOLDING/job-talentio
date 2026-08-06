import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  registerSchema,
  loginSchema,
  devLoginSchema,
  accountUpdateSchema,
  changePasswordSchema,
} from '@job-talentio/shared';
import { AuthService } from './auth.service';
import { parseDto } from '../common/utils';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth.decorators';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() body: unknown) {
    const data = parseDto(registerSchema, body);
    return this.auth.register({
      ...data,
      companyName: (body as { companyName?: string }).companyName,
    });
  }

  @Post('login')
  login(@Body() body: unknown) {
    const data = parseDto(loginSchema, body);
    return this.auth.login(data.email, data.password);
  }

  @Post('dev-login')
  devLogin(@Body() body: unknown) {
    const data = parseDto(devLoginSchema, body);
    return this.auth.devLogin(data.email, data.role);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(accountUpdateSchema, body);
    return this.auth.updateAccount(user.id, data);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(changePasswordSchema, body);
    return this.auth.changePassword(user.id, data.currentPassword, data.newPassword);
  }

  @Post('oauth/google')
  google() {
    return this.auth.oauthGoogleStub();
  }

  @Post('oauth/telegram')
  telegram() {
    return this.auth.oauthTelegramStub();
  }
}
