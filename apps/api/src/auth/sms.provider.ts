import { Logger } from '@nestjs/common';

/**
 * SMS delivery for phone OTPs. `SMS_PROVIDER=eskiz` talks to Eskiz (Uzbek
 * operator gateway, requires a legal-entity account); `mock` only logs the code
 * and is refused on public hosts so nobody can sign in as any number.
 */
export interface SmsProvider {
  readonly name: string;
  send(phone: string, text: string): Promise<void>;
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockSms');
  async send(phone: string, text: string): Promise<void> {
    this.logger.log(`SMS to ${phone}: ${text}`);
  }
}

type EskizConfig = { email: string; password: string; from: string; baseUrl?: string };

/** Eskiz.uz REST API: bearer token from /api/auth/login, then /api/message/sms. */
export class EskizSmsProvider implements SmsProvider {
  readonly name = 'eskiz';
  private readonly logger = new Logger('EskizSms');
  private token: string | null = null;
  private tokenAt = 0;

  constructor(private readonly config: EskizConfig) {}

  private base(): string {
    return (this.config.baseUrl || 'https://notify.eskiz.uz').replace(/\/$/, '');
  }

  private async login(): Promise<string> {
    // Tokens last ~30 days; refresh daily to stay safe.
    if (this.token && Date.now() - this.tokenAt < 24 * 3_600_000) return this.token;
    const res = await fetch(`${this.base()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.config.email, password: this.config.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Eskiz login responded ${res.status}`);
    const data = (await res.json()) as { data?: { token?: string } };
    if (!data.data?.token) throw new Error('Eskiz login returned no token');
    this.token = data.data.token;
    this.tokenAt = Date.now();
    return this.token;
  }

  async send(phone: string, text: string): Promise<void> {
    const token = await this.login();
    const res = await fetch(`${this.base()}/api/message/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        mobile_phone: phone.replace(/^\+/, ''),
        message: text,
        from: this.config.from,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      // Expired token: log in once more and retry.
      this.token = null;
      const fresh = await this.login();
      const retry = await fetch(`${this.base()}/api/message/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh}` },
        body: JSON.stringify({ mobile_phone: phone.replace(/^\+/, ''), message: text, from: this.config.from }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!retry.ok) throw new Error(`Eskiz send responded ${retry.status}`);
      return;
    }
    if (!res.ok) throw new Error(`Eskiz send responded ${res.status}`);
    this.logger.log(`SMS sent to ${phone.slice(0, 5)}***`);
  }
}

export function createSmsProviderFromEnv(env: NodeJS.ProcessEnv, secureRuntime: boolean): SmsProvider | null {
  const kind = (env.SMS_PROVIDER || '').trim().toLowerCase();
  if (!kind || kind === 'none') return null;
  if (kind === 'mock') {
    // A logged code on a public host would let anyone sign in as any number.
    if (secureRuntime && env.SMS_MOCK_ALLOW_PUBLIC !== '1') return null;
    return new MockSmsProvider();
  }
  if (kind === 'eskiz') {
    const email = (env.ESKIZ_EMAIL || '').trim();
    const password = (env.ESKIZ_PASSWORD || '').trim();
    if (!email || !password) return null;
    return new EskizSmsProvider({
      email,
      password,
      from: (env.ESKIZ_FROM || '4546').trim(),
      baseUrl: env.ESKIZ_BASE_URL,
    });
  }
  return null;
}
