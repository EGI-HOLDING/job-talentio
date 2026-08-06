import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor(private config: ConfigService) {
    this.from = this.config.get('SMTP_FROM', 'Job Talentio <noreply@jobtalentio.local>');
    const secure =
      String(this.config.get('SMTP_SECURE', 'false')).toLowerCase() === 'true';
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'localhost'),
      port: Number(this.config.get('SMTP_PORT', 1025)),
      secure,
      auth: this.config.get('SMTP_USER')
        ? {
            user: this.config.get('SMTP_USER'),
            pass: this.config.get('SMTP_PASS'),
          }
        : undefined,
    });
  }

  /**
   * Best-effort email. SMTP/Mailpit outages must not fail user-facing flows
   * (register, applications, alerts) after the DB write already succeeded.
   */
  async send(to: string, subject: string, html: string) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (err) {
      this.logger.error(`Email failed to ${to}: ${(err as Error).message}`);
      return null;
    }
  }
}
