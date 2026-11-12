import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { cvRequest } from './cv-assessment';
import type { CvProviderFile } from './cv-document';

export const isCvResponseId = (value: unknown): value is string =>
  typeof value === 'string' && /^resp_[a-zA-Z0-9_-]{1,180}$/.test(value);

type Usage = {
  input_tokens?: number; output_tokens?: number;
  input_tokens_details?: Record<string, number>; output_tokens_details?: Record<string, number>;
};
export type CvResponse = {
  id?: string;
  status?: string;
  metadata?: Record<string, string>;
  error?: { code?: string };
  incomplete_details?: { reason?: string };
  created_at?: number;
  completed_at?: number;
  usage?: Usage;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
};
export type CvHttp = {
  status: number;
  body?: CvResponse;
  retryAfter?: string | null;
  requestId?: string | null;
};

export function cvBackoff(failures: number, header?: string | null, now = Date.now(), jitter = Math.random()) {
  const value = header?.trim();
  const hint = !value ? 0 : /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  const local = Math.min(60000, 2000 * 2 ** Math.min(8, Math.max(0, failures)));
  return Math.max(Number.isFinite(hint) ? hint : 0, local) + Math.floor(jitter * 500);
}

export function cvRejection(response: CvHttp) {
  if (response.status === 429 && ['rate_limit_exceeded', 'slow_down'].includes(response.body?.error?.code ?? '')) return 'RETRYABLE';
  if (response.status === 503 && response.body?.error?.code === 'server_is_overloaded') return 'RETRYABLE';
  if ([400, 401, 403, 404, 413, 422, 429].includes(response.status)) return 'BLOCKED';
  return 'UNCONFIRMED';
}

export function cvTerminal(response: CvResponse) {
  if (response.status === 'completed') {
    const content = (Array.isArray(response.output) ? response.output : [])
      .filter(item => item?.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : []);
    if (content.some(item => item.type === 'refusal')) return { error: 'PROVIDER_REFUSAL' };
    try { return { result: JSON.parse(content.filter(item => item.type === 'output_text').map(item => item.text).join('')) as unknown }; }
    catch { return { error: 'INVALID_PROVIDER_OUTPUT' }; }
  }
  if (response.status === 'incomplete') return { error: response.incomplete_details?.reason === 'max_output_tokens' ? 'PROVIDER_OUTPUT_LIMIT' : 'PROVIDER_INCOMPLETE' };
  return { error: response.status === 'cancelled' ? 'PROVIDER_CANCELLED' : 'PROVIDER_FAILED' };
}

export function cvUsage(response: CvResponse, model: string) {
  const usage = response.usage;
  const inputTokens = usage?.input_tokens ?? 0, outputTokens = usage?.output_tokens ?? 0;
  const details = usage?.input_tokens_details ?? {};
  const cachedTokens = details.cached_tokens ?? 0;
  const writes = details.cache_write_tokens ?? details.cache_creation_tokens;
  const uncached = Math.max(0, inputTokens - cachedTokens - (writes ?? 0));
  const costUsd = model.startsWith('gpt-6-luna') ?
    (cachedTokens * 0.01 + (writes ?? 0) * 0.125 + uncached * (writes === undefined ? 0.125 : 0.10) + outputTokens * 0.50) / 1000000 : 0;
  return { inputTokens, outputTokens, cachedTokens, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0, costUsd };
}

@Injectable()
export class CvProvider {
  constructor(private readonly config: ConfigService) {}

  get configured() { return Boolean(this.config.get<string>('OPENAI_API_KEY')); }

  private async request(method: 'GET' | 'POST' | 'DELETE', path = '', payload?: unknown, requestId?: string): Promise<CvHttp> {
    if (!this.configured) return { status: 401, body: { error: { code: 'not_configured' } } };
    try {
      const res = await fetch('https://api.openai.com/v1/responses' + path, {
        method, headers: { Authorization: 'Bearer ' + this.config.get<string>('OPENAI_API_KEY'),
          'Content-Type': 'application/json', ...(requestId ? { 'X-Client-Request-Id': requestId } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(method === 'POST' ? 120000 : 15000),
      });
      const body = method === 'DELETE' ? undefined : await res.json().catch(() => undefined) as CvResponse | undefined;
      return { status: res.status, body, retryAfter: res.headers.get('retry-after'), requestId: res.headers.get('x-request-id') };
    } catch { return { status: 0 }; }
  }

  create(attemptId: string, model: string, spec: ReturnType<typeof cvRequest>, file?: CvProviderFile) {
    return this.request('POST', '', {
      model, background: true, store: true, reasoning: { effort: 'low', context: 'current_turn' },
      metadata: { talentio_cv_attempt: attemptId },
      max_output_tokens: spec.maxOutput, truncation: 'disabled',
      input: [
        { role: 'developer', content: spec.instructions },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(spec.data) }, ...(file ? [file] : [])] },
      ],
      text: { format: { type: 'json_schema', name: 'talentio_cv_assessment', strict: true, schema: spec.schema } },
    }, attemptId);
  }

  get(id: string) {
    if (!isCvResponseId(id)) throw new Error('CV_INVALID_RESPONSE_ID');
    return this.request('GET', '/' + id);
  }

  delete(id: string) {
    if (!isCvResponseId(id)) throw new Error('CV_INVALID_RESPONSE_ID');
    return this.request('DELETE', '/' + id);
  }
}
