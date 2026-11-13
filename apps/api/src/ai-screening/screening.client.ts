import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiScreeningCall } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { composePrompt, type ScreeningTask, type PromptPreset } from './prompts/compose';
import { assertSchema } from './screening.schemas';
import { hash, json, screeningModel } from './screening.policy';
export class AiPending extends Error {
}
export class AiUncertain extends Error {
}
type ResponseBody = {
    id?: string;
    status?: string;
    created_at?: number;
    completed_at?: number;
    output?: Array<{
        type: string;
        content?: Array<{
            type: string;
            text?: string;
        }>;
    }>;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: Record<string, number>;
        output_tokens_details?: Record<string, number>;
    };
    error?: {
        code?: string;
    };
    incomplete_details?: unknown;
};
type ProviderTiming = { createdAt?: number; acknowledgedAt?: string; firstObservedAt?: string; firstInProgressObservedAt?: string; completedAt?: number; lastStatus?: string; lastObservedAt?: string };
function responseTiming(previous: unknown, body: ResponseBody): ProviderTiming {
    const prior = previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as { providerTiming?: ProviderTiming }).providerTiming ?? {} : {};
    const observedAt = new Date().toISOString();
    return { ...prior, ...(typeof body.created_at === 'number' ? { createdAt: body.created_at } : {}),
        firstObservedAt: prior.firstObservedAt ?? observedAt,
        ...(body.status === 'in_progress' && !prior.firstInProgressObservedAt ? { firstInProgressObservedAt: observedAt } : {}),
        ...(typeof body.completed_at === 'number' ? { completedAt: body.completed_at } : {}),
        lastStatus: body.status ?? 'unknown', lastObservedAt: observedAt };
}
@Injectable()
export class ScreeningClient {
    constructor(private db: PrismaService, private config: ConfigService) { }
    get configured() { return Boolean(this.config.get<string>('OPENAI_API_KEY')); }
    private async request(path: string, init: RequestInit = {}, timeoutMs?: number) {
        return fetch('https://api.openai.com/v1/responses' + path, { ...init, headers: { Authorization: 'Bearer ' + this.config.get<string>('OPENAI_API_KEY'), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs ?? (init.method === 'POST' ? 120000 : 20000)) });
    }
    async run(workId: string, subjectId: string, task: ScreeningTask, input: unknown, preset: PromptPreset, files?: Array<{ filename: string; file_data: string }>, timeoutMs?: number): Promise<unknown> {
        if (!this.configured)
            throw new Error('TARA_PROVIDER_NOT_CONFIGURED');
        if (!preset) throw new Error('MISSING_SCREENING_PROMPT');
        const prompt = composePrompt(task, input, preset), model = preset.model ?? screeningModel(), inputHash = hash([prompt, model, files]);
        let call = await this.db.aiScreeningCall.findFirst({ where: { workId, inputHash, status: { not: 'RECOVERED' } }, orderBy: { createdAt: 'desc' } });
        if (!call && await this.db.aiScreeningCall.count({ where: { workId, status: { in: ['RUNNING', 'UNCERTAIN'] } } }))
            throw new AiUncertain('TARA_CALL_INPUT_CHANGED_REQUIRES_REVIEW');
        if (call?.status === 'ERASED')
            throw new Error('SESSION_ERASED');
        if (call?.status === 'COMPLETED')
            return call.result;
        if (call?.status === 'UNCERTAIN' && !call.responseId)
            throw new AiUncertain('TARA_CALL_UNCERTAIN');
        if (call?.status === 'RUNNING' && !call.responseId) {
            if (Date.now() - +call.updatedAt < 150000)
                throw new AiPending('TARA_CALL_IN_FLIGHT');
            await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'CREATE_RESPONSE_UNCONFIRMED' } });
            throw new AiUncertain('TARA_CALL_UNCERTAIN');
        }
        if (!call || ['FAILED', 'INVALID'].includes(call.status)) {
            const singleSubmission = task === 'candidate' || task === 'live-agenda';
            if (singleSubmission && (call || await this.db.aiScreeningCall.count({ where: { workId, task } })))
                throw new Error(task === 'candidate' ? 'TARA_CANDIDATE_ALREADY_SUBMITTED' : 'TARA_LIVE_AGENDA_ALREADY_SUBMITTED');
            const count = await this.db.aiScreeningCall.count({ where: { workId, inputHash } });
            const activeCount = await this.db.aiScreeningCall.count({ where: { workId, inputHash, status: { not: 'RECOVERED' } } });
            if (activeCount >= 3)
                throw new Error('TARA_RETRY_LIMIT');
            try {
                call = await this.db.aiScreeningCall.create({ data: { key: singleSubmission ? workId + ':' + task : workId + ':' + inputHash + ':' + count,
                    workId, subjectId, task, model, inputHash, promptVersion: prompt.version, status: 'RUNNING' } });
            } catch (error) {
                if (singleSubmission && (error as { code?: string })?.code === 'P2002') throw new AiPending('TARA_CALL_IN_FLIGHT');
                throw error;
            }
            let response: Response;
            try {
                response = await this.request('', { method: 'POST', body: JSON.stringify({
                        model, background: true, store: true, reasoning: { effort: prompt.reasoning, context: 'current_turn' },
                        max_output_tokens: prompt.maxOutput,
                        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
                        input: [{ role: 'developer', content: [{ type: 'input_text', text: prompt.instructions, prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } }] }, ...prompt.input.map(item => files?.length ? { ...item, content: [{ type: 'input_text', text: item.content }, ...files.map(file => ({ type: 'input_file', ...file }))] } : item)],
                        text: { format: { type: 'json_schema', name: prompt.name, strict: true, schema: prompt.schema } },
                    }) }, timeoutMs);
            }
            catch {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'CREATE_RESPONSE_UNCONFIRMED' } });
                throw new AiUncertain('TARA_CALL_UNCERTAIN');
            }
            if (!response.ok) {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'FAILED', error: 'PROVIDER_HTTP_' + response.status } });
                throw new Error('TARA_PROVIDER_HTTP_' + response.status);
            }
            let body: ResponseBody;
            try { body = await response.json() as ResponseBody; }
            catch {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'CREATE_RESPONSE_UNCONFIRMED' } });
                throw new AiUncertain('TARA_CALL_UNCERTAIN');
            }
            if (!body.id || !/^resp_[a-zA-Z0-9_-]+$/.test(body.id)) {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'MISSING_RESPONSE_ID' } });
                throw new AiUncertain('TARA_CALL_UNCERTAIN');
            }
            call = await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { responseId: body.id, usage: json({ providerTiming: { acknowledgedAt: new Date().toISOString() } }) } });
            return this.consume(call, body, prompt.schema);
        }
        return this.poll(call, prompt.schema, timeoutMs);
    }

    async pollCandidate(call: AiScreeningCall, timeoutMs: number) {
        if (call.task !== 'candidate' || !['RUNNING', 'UNCERTAIN'].includes(call.status)) return;
        return this.poll(call, undefined, timeoutMs);
    }

    async pollLiveAgenda(call: AiScreeningCall, preset: PromptPreset, timeoutMs: number) {
        if (call.task !== 'live-agenda' || !['RUNNING', 'UNCERTAIN'].includes(call.status)) return;
        return this.poll(call, preset.schema, timeoutMs);
    }

    private async poll(call: AiScreeningCall, schema: Parameters<typeof assertSchema>[0] | undefined, timeoutMs?: number) {
        if (!call.responseId || !/^resp_[a-zA-Z0-9_-]+$/.test(call.responseId)) throw new AiUncertain('TARA_CALL_UNCERTAIN');
        let response: Response;
        try { response = await this.request('/' + call.responseId, {}, timeoutMs); }
        catch { throw new AiPending('TARA_RESPONSE_POLL_RETRY'); }
        // A stored background response remains resumable by ID, even after a long queue.
        // Local elapsed time must never discard a completed provider result.
        if (!response.ok) {
            if ([401, 403, 404, 410].includes(response.status)) {
                await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { status: 'UNCERTAIN', error: 'PROVIDER_RESPONSE_REQUIRES_REVIEW' } });
                throw new AiUncertain('TARA_RESPONSE_REQUIRES_REVIEW');
            }
            throw new AiPending('TARA_RESPONSE_POLL_RETRY');
        }
        let body: ResponseBody;
        try { body = await response.json() as ResponseBody; }
        catch { throw new AiPending('TARA_RESPONSE_POLL_RETRY'); }
        return this.consume(call, body, schema);
    }
    private async consume(call: {
        id: string;
        responseId: string | null;
        usage?: unknown;
        task: string;
    }, body: ResponseBody, schema: Parameters<typeof assertSchema>[0] | undefined) {
        const timing = responseTiming(call.usage, body);
        if (body.status === 'queued' || body.status === 'in_progress') {
            const previous = call.usage && typeof call.usage === 'object' ? (call.usage as { providerTiming?: ProviderTiming }).providerTiming : undefined;
            if (previous?.lastStatus !== body.status)
                await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { usage: json({ providerTiming: timing }) } });
            throw new AiPending('TARA_RESPONSE_PENDING');
        }
        const retained = await this.db.aiScreeningCall.findUnique({ where: { id: call.id }, select: { status: true } });
        if (!retained || retained.status === 'ERASED') {
            if (call.responseId)
                await this.request('/' + call.responseId, { method: 'DELETE' }).catch(() => undefined);
            throw new Error('SESSION_ERASED');
        }
        const usage = body.usage ?? {}, details = usage.input_tokens_details ?? {};
        const input = usage.input_tokens ?? 0, output = usage.output_tokens ?? 0, cached = details.cached_tokens ?? 0;
        // Cache-write accounting varies by API version. Use the published write rate as
        // a conservative upper estimate for non-cache-read input when no split exists.
        const writes = details.cache_write_tokens ?? details.cache_creation_tokens;
        const uncached = Math.max(0, input - cached - (writes ?? 0));
        const cost = (cached * 0.01 + (writes ?? 0) * 0.125 + uncached * (writes === undefined ? 0.125 : 0.10) + output * 0.50) / 1000000;
        const accounting = { inputTokens: input, outputTokens: output, cachedTokens: cached, reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
            usage: json({ ...usage, providerTiming: timing }), costUsd: cost, pricing: { input: 0.10, cacheRead: 0.01, cacheWrite: 0.125, output: 0.50, unit: 1000000, conservative: writes === undefined } };
        const preparation = call.task === 'candidate' || call.task === 'live-agenda';
        if (body.status !== 'completed') {
            await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { ...accounting, status: 'FAILED', error: 'PROVIDER_' + (body.status ?? 'FAILED') } });
            if (call.task === 'live-agenda' && call.responseId)
                await this.request('/' + call.responseId, { method: 'DELETE' }, 2000).catch(() => undefined);
            throw new Error('TARA_RESPONSE_FAILED');
        }
        const content = (body.output ?? []).filter(o => o.type === 'message').flatMap(o => o.content ?? []);
        let result: unknown;
        try {
            if (content.some(c => c.type === 'refusal'))
                throw new Error('PROVIDER_REFUSAL');
            result = JSON.parse(content.filter(c => c.type === 'output_text').map(c => c.text ?? '').join(''));
            if (call.task === 'candidate') {
                // Store the envelope so each proposal can be grounded independently.
                if (!result || typeof result !== 'object' || !('claims' in result) || !Array.isArray(result.claims))
                    throw new Error('TARA_INVALID_CANDIDATE_ENVELOPE');
                result = { claims: result.claims.slice(0, 8) };
            } else {
                if (!schema) throw new Error('MISSING_SCREENING_PROMPT');
                assertSchema(schema, result);
            }
        }
        catch (error) {
            await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { ...accounting, status: 'INVALID', error: 'INVALID_PROVIDER_OUTPUT' } });
            if (preparation && call.responseId)
                await this.request('/' + call.responseId, { method: 'DELETE' }, 2000).catch(() => undefined);
            throw new Error('TARA_INVALID_OUTPUT');
        }
        const saved = await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { ...accounting, status: 'COMPLETED', error: null, result: json(result) } });
        if (!saved.count) throw new Error('SESSION_ERASED');
        if (call.responseId)
            await this.request('/' + call.responseId, { method: 'DELETE' }, preparation ? 2000 : undefined).catch(() => undefined);
        return result;
    }
}
