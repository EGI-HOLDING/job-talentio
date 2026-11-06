import type { ConfigService } from '@nestjs/config';

const DEFAULT_MODEL = 'gpt-6-luna';
const DEFAULT_TIMEOUT_MS = 45_000;
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export type OpenAiChatJsonInput = {
  system: string;
  user: string;
  /** Cap completion size to control cost. */
  maxTokens?: number;
};

/**
 * Minimal Chat Completions client (JSON mode), used by optional machine
 * translation only. CV parsing does not integrate with external API providers.
 * Uses fetch — no SDK dependency.
 *
 * Two model families disagree on request shape, so both are handled here:
 * - Legacy chat models (gpt-4o-mini) reject `reasoning_effort` outright.
 * - Reasoning models (gpt-5/gpt-6/o-series) reject a fixed `temperature`
 *   unless reasoning is disabled with `reasoning_effort: 'none'`.
 * `reasoningEffort` is therefore configuration, not a constant: unset keeps the
 * legacy request byte-for-byte, `none` keeps this client deterministic.
 */
export class OpenAiClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly reasoningEffort?: string;

  constructor(opts: {
    apiKey: string;
    model?: string;
    timeoutMs?: number;
    reasoningEffort?: string;
  }) {
    this.apiKey = (opts.apiKey || '').trim();
    this.model = (opts.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const effort = (opts.reasoningEffort || '').trim().toLowerCase();
    this.reasoningEffort = effort || undefined;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Build the JSON payload for one completion.
   *
   * `max_completion_tokens` is the current name; the deprecated `max_tokens` is
   * rejected by reasoning models. `temperature` is only safe when the model runs
   * without reasoning, so it is dropped as soon as a reasoning budget is applied.
   */
  private requestBody(input: OpenAiChatJsonInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      response_format: { type: 'json_object' },
      max_completion_tokens: input.maxTokens ?? 2_048,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    };
    if (this.reasoningEffort) body.reasoning_effort = this.reasoningEffort;
    if (!this.reasoningEffort || this.reasoningEffort === 'none') body.temperature = 0;
    return body;
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
      body: JSON.stringify(this.requestBody(input)),
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
  // Unset for legacy models, which reject the parameter; `none` on reasoning
  // models keeps output deterministic and cheap for translation.
  const reasoningEffort = config.get<string>('OPENAI_REASONING_EFFORT');
  return new OpenAiClient({ apiKey, model, reasoningEffort });
}
