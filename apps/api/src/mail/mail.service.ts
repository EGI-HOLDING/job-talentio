import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { isDemoMailbox } from '../common/demo-mailboxes';

/**
 * Railway Free/Hobby/Trial block outbound SMTP (ports 25/465/587).
 * Prefer Resend HTTPS when RESEND_API_KEY is set; fall back to SMTP for
 * local Mailpit and Railway Pro.
 *
 * Set RESEND_API_KEY in Railway (never commit the real key).
 * Until jobtalent.io is verified in Resend, use:
 *   SMTP_FROM="Job Talentio <onboarding@resend.dev>"
 * After domain verify, switch to:
 *   SMTP_FROM="Job Talentio <info@jobtalent.io>"
 *
 * Seed/dummy mailboxes (see demo-mailboxes.ts) never receive outbound mail.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private resend: Resend | null = null;
  private from: string;

  constructor(private config: ConfigService) {
    this.from = this.config.get('SMTP_FROM', 'Job Talentio <noreply@jobtalentio.local>');
    const resendApiKey = this.config.get<string>('RESEND_API_KEY')?.trim() || null;

    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
    } else {
      const secure =
        String(this.config.get('SMTP_SECURE', 'false')).toLowerCase() === 'true';
      this.transporter = nodemailer.createTransport({
        host: this.config.get('SMTP_HOST', 'localhost'),
        port: Number(this.config.get('SMTP_PORT', 1025)),
        secure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        auth: this.config.get('SMTP_USER')
          ? {
              user: this.config.get('SMTP_USER'),
              pass: this.config.get('SMTP_PASS'),
            }
          : undefined,
      });
    }
  }

  onModuleInit() {
    if (this.resend) {
      this.logger.log('Mail transport: Resend SDK (from ' + this.from + ')');
    } else {
      this.logger.warn(
        'Mail transport: SMTP. On Railway Hobby/Trial, outbound SMTP is blocked — set RESEND_API_KEY to send mail.',
      );
    }
  }

  /**
   * Best-effort email. Provider outages must not fail user-facing flows
   * after the DB write already succeeded. Dummy/seed inboxes are skipped.
   */
  async send(to: string, subject: string, html: string) {
    if (isDemoMailbox(to)) {
      this.logger.log(`Skip email to demo mailbox ${to}: ${subject}`);
      return { skipped: true as const, to, subject };
    }
    try {
      if (this.resend) {
        return await this.sendViaResend(to, subject, html);
      }
      return await this.sendViaSmtp(to, subject, html);
    } catch (err) {
      this.logger.error(`Email failed to ${to}: ${(err as Error).message}`);
      return null;
    }
  }

  private async sendViaResend(to: string, subject: string, html: string) {
    if (!this.resend) throw new Error('Resend client not configured');
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: [to],
      subject,
      html,
    });
    if (error) {
      throw new Error(error.message || 'Resend send failed');
    }
    this.logger.log(`Email sent to ${to} via Resend: ${data?.id ?? 'ok'}`);
    return data;
  }

  private async sendViaSmtp(to: string, subject: string, html: string) {
    if (!this.transporter) throw new Error('SMTP transporter not configured');
    const info = await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
    });
    this.logger.log(`Email sent to ${to}: ${info.messageId}`);
    return info;
  }
}
