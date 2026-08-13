import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  registerSchema,
  loginSchema,
  devLoginSchema,
  accountUpdateSchema,
  changePasswordSchema,
  googleOAuthSchema,
  telegramOAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changeEmailSchema,
  confirmEmailChangeSchema,
  refreshTokenSchema,
  logoutSchema,
  deleteAccountSchema,
} from '@job-talentio/shared';
import { AuthService } from './auth.service';
import { parseDto } from '../common/utils';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth.decorators';
import { imageUploadOptions } from '../common/upload';
import { TelegramService } from '../telegram/telegram.service';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private telegramService: TelegramService,
  ) {}

  @Post('register')
  register(@Body() body: unknown) {
    const data = parseDto(registerSchema, body);
    return this.auth.register({
      email: data.email,
      password: data.password,
      fullName: data.fullName,
      role: data.role,
      locale: data.locale,
      companyName: data.companyName,
      inviteToken: data.inviteToken,
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

  @Post('refresh')
  refresh(@Body() body: unknown) {
    const data = parseDto(refreshTokenSchema, body);
    return this.auth.refresh(data.refreshToken);
  }

  @Post('logout')
  logout(@Body() body: unknown) {
    const data = parseDto(logoutSchema, body);
    return this.auth.logout(data.refreshToken);
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

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.auth.uploadAvatar(user.id, file);
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  clearAvatar(@CurrentUser() user: AuthUser) {
    return this.auth.clearAvatar(user.id);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  deleteMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(deleteAccountSchema, body);
    return this.auth.deleteMyAccount(user.id, data);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(changePasswordSchema, body);
    return this.auth.changePassword(user.id, data.currentPassword, data.newPassword);
  }

  @Post('oauth/google')
  google(@Body() body: unknown) {
    const data = parseDto(googleOAuthSchema, body);
    return this.auth.oauthGoogle(data);
  }

  @Post('verify-email')
  verifyEmail(@Body() body: unknown) {
    const data = parseDto(verifyEmailSchema, body);
    return this.auth.verifyEmail(data.token);
  }

  @Post('resend-verification')
  resendVerification(@Body() body: unknown) {
    const data = parseDto(resendVerificationSchema, body);
    return this.auth.resendVerification(data.email);
  }

  /** Logged-in user requests a verification email (job seeker profile CTA). */
  @Post('request-verification')
  @UseGuards(JwtAuthGuard)
  requestVerification(@CurrentUser() user: AuthUser) {
    return this.auth.requestVerification(user.id);
  }

  @Get('telegram/config')
  telegramConfig() {
    return this.auth.telegramWidgetConfig();
  }

  @Post('oauth/telegram')
  telegram(@Body() body: unknown) {
    const data = parseDto(telegramOAuthSchema, body);
    return this.auth.oauthTelegram(data);
  }

  @Post('oauth/telegram/connect')
  @UseGuards(JwtAuthGuard)
  connectTelegram(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(telegramOAuthSchema, body);
    return this.auth.connectTelegram(user.id, data);
  }

  @Post('telegram/link')
  @UseGuards(JwtAuthGuard)
  createTelegramLink(@CurrentUser() user: AuthUser) {
    return this.telegramService.createLink(user.id);
  }

  @Delete('telegram/link')
  @UseGuards(JwtAuthGuard)
  unlinkTelegram(@CurrentUser() user: AuthUser) {
    return this.telegramService.unlink(user.id);
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: unknown) {
    const data = parseDto(forgotPasswordSchema, body);
    return this.auth.forgotPassword(data.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: unknown) {
    const data = parseDto(resetPasswordSchema, body);
    return this.auth.resetPassword(data.token, data.newPassword);
  }

  @Post('change-email')
  @UseGuards(JwtAuthGuard)
  changeEmail(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(changeEmailSchema, body);
    return this.auth.requestEmailChange(user.id, data.newEmail, data.currentPassword);
  }

  @Post('confirm-email-change')
  confirmEmailChange(@Body() body: unknown) {
    const data = parseDto(confirmEmailChangeSchema, body);
    return this.auth.confirmEmailChange(data.token);
  }
}
