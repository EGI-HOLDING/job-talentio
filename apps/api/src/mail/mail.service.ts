import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

/**
 * Railway Free/Hobby/Trial block outbound SMTP (ports 25/465/587).
 * Prefer Resend HTTPS when RESEND_API_KEY is set; fall back to SMTP for
 * local Mailpit and Railway Pro.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private from: string;
  private resendApiKey: string | null = null;

  constructor(private config: ConfigService) {
    this.from = this.config.get('SMTP_FROM', 'Job Talentio <noreply@jobtalentio.local>');
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY')?.trim() || null;

    if (!this.resendApiKey) {
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
    if (this.resendApiKey) {
      this.logger.log('Mail transport: Resend HTTPS API (from ' + this.from + ')');
    } else {
      this.logger.warn(
        'Mail transport: SMTP. On Railway Hobby/Trial, outbound SMTP is blocked — set RESEND_API_KEY to send mail.',
      );
    }
  }

  /**
   * Best-effort email. Provider outages must not fail user-facing flows
   * after the DB write already succeeded.
   */
  async send(to: string, subject: string, html: string) {
    try {
      if (this.resendApiKey) {
        return await this.sendViaResend(to, subject, html);
      }
      return await this.sendViaSmtp(to, subject, html);
    } catch (err) {
      this.logger.error(`Email failed to ${to}: ${(err as Error).message}`);
      return null;
    }
  }

  private async sendViaResend(to: string, subject: string, html: string) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject,
        html,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!res.ok) {
      throw new Error(body.message || body.name || `Resend HTTP ${res.status}`);
    }
    this.logger.log(`Email sent to ${to} via Resend: ${body.id ?? 'ok'}`);
    return body;
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
