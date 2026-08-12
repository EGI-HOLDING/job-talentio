import type { ConfigService } from '@nestjs/config';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 45_000;
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export type OpenAiChatJsonInput = {
  system: string;
  user: string;
  /** Cap completion size to control cost. */
  maxTokens?: number;
};

/**
 * Minimal Chat Completions client (JSON mode). Shared by CV parse and MT.
 * Uses fetch — no SDK dependency.
 */
export class OpenAiClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.apiKey = (opts.apiKey || '').trim();
    this.model = (opts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async chatJson<T = unknown>(input: OpenAiChatJsonInput): Promise<T> {
    if (!this.enabled) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: input.maxTokens ?? 2_048,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      throw new Error('OpenAI returned empty content');
    }

    return JSON.parse(content) as T;
  }
}

export function createOpenAiClient(
  config: ConfigService,
  opts?: { apiKeyFallback?: string },
): OpenAiClient {
  const apiKey =
    (config.get<string>('OPENAI_API_KEY') || '').trim() ||
    (opts?.apiKeyFallback || '').trim();
  const model = config.get<string>('OPENAI_MODEL') || DEFAULT_MODEL;
  return new OpenAiClient({ apiKey, model });
}
