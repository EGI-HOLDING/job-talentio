import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
@Injectable()
export class ScreeningClient {
    constructor(private db: PrismaService, private config: ConfigService) { }
    get configured() { return Boolean(this.config.get<string>('OPENAI_API_KEY')); }
    private async request(path: string, init: RequestInit = {}) {
        return fetch('https://api.openai.com/v1/responses' + path, { ...init, headers: { Authorization: 'Bearer ' + this.config.get<string>('OPENAI_API_KEY'), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) });
    }
    async run(workId: string, subjectId: string, task: ScreeningTask, input: unknown, preset?: PromptPreset): Promise<unknown> {
        if (!this.configured)
            throw new Error('TARA_PROVIDER_NOT_CONFIGURED');
        const prompt = composePrompt(task, input, preset), model = preset?.model ?? screeningModel(), inputHash = hash([prompt, model]);
        let call = await this.db.aiScreeningCall.findFirst({ where: { workId, inputHash, status: { not: 'RECOVERED' } }, orderBy: { createdAt: 'desc' } });
        if (call?.status === 'ERASED')
            throw new Error('SESSION_ERASED');
        if (call?.status === 'COMPLETED')
            return call.result;
        if (call?.status === 'UNCERTAIN')
            throw new AiUncertain('TARA_CALL_UNCERTAIN');
        if (call?.status === 'RUNNING' && !call.responseId) {
            if (Date.now() - +call.updatedAt < 30000)
                throw new AiPending('TARA_CALL_IN_FLIGHT');
            await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'CREATE_RESPONSE_UNCONFIRMED' } });
            throw new AiUncertain('TARA_CALL_UNCERTAIN');
        }
        if (!call || ['FAILED', 'INVALID'].includes(call.status)) {
            const count = await this.db.aiScreeningCall.count({ where: { workId, inputHash } });
            const activeCount = await this.db.aiScreeningCall.count({ where: { workId, inputHash, status: { not: 'RECOVERED' } } });
            if (activeCount >= 3)
                throw new Error('TARA_RETRY_LIMIT');
            call = await this.db.aiScreeningCall.create({ data: { key: workId + ':' + inputHash + ':' + count, workId, subjectId, task, model, inputHash, promptVersion: prompt.version, status: 'RUNNING' } });
            let response: Response;
            try {
                response = await this.request('', { method: 'POST', body: JSON.stringify({
                        model, background: true, store: true, reasoning: { effort: prompt.reasoning, context: 'current_turn' },
                        max_output_tokens: prompt.maxOutput,
                        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
                        input: [{ role: 'developer', content: [{ type: 'input_text', text: prompt.instructions, prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } }] }, ...prompt.input],
                        text: { format: { type: 'json_schema', name: prompt.name, strict: true, schema: prompt.schema } },
                    }) });
            }
            catch {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'CREATE_RESPONSE_UNCONFIRMED' } });
                throw new AiUncertain('TARA_CALL_UNCERTAIN');
            }
            if (!response.ok) {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'FAILED', error: 'PROVIDER_HTTP_' + response.status } });
                throw new Error('TARA_PROVIDER_HTTP_' + response.status);
            }
            const body = await response.json() as ResponseBody;
            if (!body.id || !/^resp_[a-zA-Z0-9_-]+$/.test(body.id)) {
                await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { status: 'UNCERTAIN', error: 'MISSING_RESPONSE_ID' } });
                throw new AiUncertain('TARA_CALL_UNCERTAIN');
            }
            call = await this.db.aiScreeningCall.update({ where: { id: call.id }, data: { responseId: body.id } });
            return this.consume(call, body, prompt.schema);
        }
        if (!call.responseId)
            throw new AiUncertain('TARA_CALL_UNCERTAIN');
        const response = await this.request('/' + call.responseId);
        if (!response.ok || Date.now() - +call.createdAt > 15 * 60000) {
            if ([401, 403, 404, 410].includes(response.status) || Date.now() - +call.createdAt > 15 * 60000) {
                await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { status: 'UNCERTAIN', error: 'PROVIDER_RESPONSE_REQUIRES_REVIEW' } });
                throw new AiUncertain('TARA_RESPONSE_REQUIRES_REVIEW');
            }
            throw new AiPending('TARA_RESPONSE_POLL_RETRY');
        }
        return this.consume(call, await response.json() as ResponseBody, prompt.schema);
    }
    private async consume(call: {
        id: string;
        responseId: string | null;
    }, body: ResponseBody, schema: Parameters<typeof assertSchema>[0]) {
        if (body.status === 'queued' || body.status === 'in_progress')
            throw new AiPending('TARA_RESPONSE_PENDING');
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
            usage: json(usage), costUsd: cost, pricing: { input: 0.10, cacheRead: 0.01, cacheWrite: 0.125, output: 0.50, unit: 1000000, conservative: writes === undefined } };
        if (body.status !== 'completed') {
            await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { ...accounting, status: 'FAILED', error: 'PROVIDER_' + (body.status ?? 'FAILED') } });
            throw new Error('TARA_RESPONSE_FAILED');
        }
        const content = (body.output ?? []).filter(o => o.type === 'message').flatMap(o => o.content ?? []);
        try {
            if (content.some(c => c.type === 'refusal'))
                throw new Error('PROVIDER_REFUSAL');
            const result: unknown = JSON.parse(content.filter(c => c.type === 'output_text').map(c => c.text ?? '').join(''));
            assertSchema(schema, result);
            const saved = await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { ...accounting, status: 'COMPLETED', result: json(result) } });
            if (!saved.count)
                throw new Error('SESSION_ERASED');
            if (call.responseId)
                await this.request('/' + call.responseId, { method: 'DELETE' }).catch(() => undefined);
            return result;
        }
        catch (error) {
            await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { not: 'ERASED' } }, data: { ...accounting, status: 'INVALID', error: 'INVALID_PROVIDER_OUTPUT' } });
            throw new Error('TARA_INVALID_OUTPUT');
        }
    }
}
