/**
 * Guards the Chat Completions request shape.
 *
 * Two model families disagree, and getting it wrong fails every translation:
 * - legacy models (gpt-4o-mini) reject `reasoning_effort` with a 400
 * - reasoning models (gpt-6) reject a fixed `temperature` unless reasoning is off
 * - `max_tokens` is deprecated; reasoning models require `max_completion_tokens`
 */
import assert from 'node:assert/strict';
import { OpenAiClient, createOpenAiClient } from './openai.client';
import type { ConfigService } from '@nestjs/config';

type Captured = { url: string; init: RequestInit; body: Record<string, unknown> };

function stubFetch(reply: unknown, status = 200): Captured[] {
  const calls: Captured[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init: RequestInit,
  ) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    };
  };
  return calls;
}

function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

async function main() {
  const input = { system: 'JSON only.', user: 'Return {"ok":true}' };
  const reply = { choices: [{ message: { content: '{"ok":true}' } }] };

  // Legacy model: no reasoning parameter at all, temperature stays deterministic.
  {
    const calls = stubFetch(reply);
    const client = new OpenAiClient({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    assert.deepEqual(await client.chatJson(input), { ok: true });
    const body = calls[0].body;
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.temperature, 0, 'legacy models keep temperature 0');
    assert.equal(body.max_completion_tokens, 2_048, 'uses max_completion_tokens');
    assert.ok(!('max_tokens' in body), 'must not send deprecated max_tokens');
    assert.ok(!('reasoning_effort' in body), 'legacy models reject reasoning_effort');
  }

  // Reasoning model with reasoning disabled: deterministic translation.
  {
    const calls = stubFetch(reply);
    const client = new OpenAiClient({
      apiKey: 'sk-test',
      model: 'gpt-6-luna',
      reasoningEffort: 'none',
    });
    await client.chatJson({ ...input, maxTokens: 512 });
    const body = calls[0].body;
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.temperature, 0, 'temperature 0 is allowed when reasoning is off');
    assert.equal(body.max_completion_tokens, 512);
  }

  // Reasoning model with a real budget: temperature must be omitted or OpenAI 400s.
  {
    const calls = stubFetch(reply);
    const client = new OpenAiClient({
      apiKey: 'sk-test',
      model: 'gpt-6-luna',
      reasoningEffort: 'MEDIUM ',
    });
    await client.chatJson(input);
    const body = calls[0].body;
    assert.equal(body.reasoning_effort, 'medium', 'effort is normalised');
    assert.ok(!('temperature' in body), 'temperature is rejected by reasoning models');
  }

  // Config wiring: the effort comes from OPENAI_REASONING_EFFORT and the default
  // model is the reasoning one, so a fresh deployment still works.
  {
    const calls = stubFetch(reply);
    const client = createOpenAiClient(fakeConfig({ OPENAI_API_KEY: 'sk-test' }));
    await client.chatJson(input);
    assert.equal(client.model, 'gpt-6-luna', 'default model is gpt-6-luna');
    assert.ok(
      !('reasoning_effort' in calls[0].body),
      'unset env leaves the parameter out so legacy models keep working',
    );
  }

  {
    const calls = stubFetch(reply);
    const client = createOpenAiClient(
      fakeConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_REASONING_EFFORT: 'none' }),
    );
    await client.chatJson(input);
    assert.equal(calls[0].body.reasoning_effort, 'none');
  }

  // Failures must surface the status without leaking the key into logs.
  {
    stubFetch({ error: { message: 'Unrecognized request argument supplied' } }, 400);
    const client = new OpenAiClient({ apiKey: 'sk-secret-value', model: 'gpt-6-luna' });
    await assert.rejects(
      () => client.chatJson(input),
      (err: Error) => {
        assert.match(err.message, /OpenAI responded 400/);
        assert.ok(!err.message.includes('sk-secret-value'), 'key must never appear');
        return true;
      },
    );
  }

  {
    stubFetch({ choices: [{ message: { content: '   ' } }] });
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    await assert.rejects(() => client.chatJson(input), /empty content/);
  }

  {
    const client = new OpenAiClient({ apiKey: '' });
    assert.equal(client.enabled, false);
    await assert.rejects(() => client.chatJson(input), /not configured/);
  }

  console.log('openai client: smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
