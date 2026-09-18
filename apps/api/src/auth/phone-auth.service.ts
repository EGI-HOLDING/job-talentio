import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { isSecureRuntime } from '../common/jwt-secret';
import { createSmsProviderFromEnv, type SmsProvider } from './sms.provider';
import {
  PHONE_LOGIN_TTL_MS,
  PHONE_OTP_MAX_ATTEMPTS,
  PHONE_OTP_TTL_MS,
  generateOtpCode,
  normalizePhone,
  phoneLoginDeepLink,
} from './phone.util';

const OTP_RESEND_WINDOW_MS = 60 * 1000;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Phone number as the front door. Two routes: a Telegram contact share (free,
 * verified by Telegram) and SMS one-time codes when an operator account exists.
 */
@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);
  private readonly sms: SmsProvider | null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private auth: AuthService,
  ) {
    this.sms = createSmsProviderFromEnv(process.env, isSecureRuntime());
    if (this.sms) this.logger.log(`SMS OTP enabled via ${this.sms.name}`);
  }

  private botUsername(): string {
    return this.config.get<string>('TELEGRAM_BOT_USERNAME', '').replace(/^@/, '').trim();
  }

  private telegramAvailable(): boolean {
    return Boolean(this.config.get<string>('TELEGRAM_BOT_TOKEN', '').trim() && this.botUsername());
  }

  providers() {
    return { telegram: this.telegramAvailable(), sms: Boolean(this.sms) };
  }

  /** Web asks for a one-time deep link; the bot completes it when the contact arrives. */
  async startTelegramLogin(locale?: string) {
    if (!this.telegramAvailable()) {
      throw new ServiceUnavailableException('Telegram sign-in is not configured');
    }
    const raw = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + PHONE_LOGIN_TTL_MS);
    await this.prisma.phoneLoginToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.phoneLoginToken.create({
      data: {
        tokenHash: sha256(raw),
        locale: locale && ['uz', 'ru', 'en'].includes(locale) ? locale : 'uz',
        expiresAt,
      },
    });
    return {
      token: raw,
      deepLink: phoneLoginDeepLink(this.botUsername(), raw),
      botUsername: this.botUsername(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Polled by the browser. The session is handed out once; the token is then consumed. */
  async telegramLoginStatus(rawToken: string) {
    if (!/^[a-f0-9]{32,96}$/i.test(rawToken)) throw new BadRequestException('Invalid token');
    const row = await this.prisma.phoneLoginToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!row) return { status: 'EXPIRED' as const };
    if (row.expiresAt < new Date()) {
      await this.prisma.phoneLoginToken.delete({ where: { id: row.id } }).catch(() => undefined);
      return { status: 'EXPIRED' as const };
    }
    if (row.status !== 'COMPLETED' || !row.userId) {
      return { status: row.status === 'CONTACT_REQUESTED' ? ('CONTACT_REQUESTED' as const) : ('PENDING' as const) };
    }
    const user = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { isBanned: true } });
    await this.prisma.phoneLoginToken.delete({ where: { id: row.id } }).catch(() => undefined);
    if (!user) throw new NotFoundException('Account not found');
    if (user.isBanned) throw new ForbiddenException('Account banned');
    const session = await this.auth.sessionForUser(row.userId);
    return { status: 'COMPLETED' as const, session };
  }

  async requestOtp(rawPhone: string) {
    if (!this.sms) throw new ServiceUnavailableException('SMS sign-in is not configured');
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid phone number');

    const recent = await this.prisma.phoneOtp.findFirst({
      where: { phone, createdAt: { gt: new Date(Date.now() - OTP_RESEND_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) throw new TooManyRequestsException('Wait a minute before requesting another code');

    const code = generateOtpCode();
    await this.prisma.phoneOtp.deleteMany({ where: { OR: [{ phone }, { expiresAt: { lt: new Date() } }] } });
    await this.prisma.phoneOtp.create({
      data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + PHONE_OTP_TTL_MS) },
    });
    await this.sms.send(phone, `Job Talentio: ${code}`);
    return { ok: true, expiresInSeconds: PHONE_OTP_TTL_MS / 1000 };
  }

  async verifyOtp(rawPhone: string, code: string, locale?: string) {
    if (!this.sms) throw new ServiceUnavailableException('SMS sign-in is not configured');
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid phone number');
    const otp = await this.prisma.phoneOtp.findFirst({
      where: { phone, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('Code expired. Request a new one.');
    if (otp.attempts >= PHONE_OTP_MAX_ATTEMPTS) {
      await this.prisma.phoneOtp.delete({ where: { id: otp.id } }).catch(() => undefined);
      throw new TooManyRequestsException('Too many attempts. Request a new code.');
    }
    if (otp.codeHash !== sha256(`${phone}:${code.trim()}`)) {
      await this.prisma.phoneOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Wrong code');
    }
    await this.prisma.phoneOtp.deleteMany({ where: { phone } });

    let user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true, isBanned: true } });
    if (user?.isBanned) throw new ForbiddenException('Account banned');
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          fullName: phone,
          role: 'EMPLOYEE',
          locale: locale && ['uz', 'ru', 'en'].includes(locale) ? locale : 'uz',
          phone,
          phoneVerifiedAt: new Date(),
          employeeProfile: { create: {} },
        },
        select: { id: true, isBanned: true },
      });
    } else {
      await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
    }
    return this.auth.sessionForUser(user.id);
  }
}
