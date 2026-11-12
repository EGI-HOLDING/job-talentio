import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VoiceInterview } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { requireCurrentConversation } from '../conversation.policy';
import { createVoiceRequest, TARA_LIVE_MODEL } from '../prompts/voice-session';
import type { PromptRegistry } from '../prompts/registry';
import { ScreeningClient } from '../screening.client';
import { enqueueWork } from '../screening-packets.service';
import { json, screeningEnabled } from '../screening.policy';
import type { CandidatePayload, PackagePayload } from '../screening.schemas';
import { ScreeningSessions } from '../screening-sessions.service';
import { evaluateTakaInterview } from '../taka-evaluation';
import { frozenTakaInterview, liveTakaTurns } from '../taka-interview';
import { startTara, taraInterviewReport, taraTopics, type TaraTopic } from '../tara-interview';
import { nativeCoverage, nativeInterview, nativeVoiceTurns, NATIVE_STARTUP_MS, NATIVE_VOICE_VERSION, recordMedia,
    type MediaSignal, type NativeDelivery, type NativeProgress } from './voice-native';
import { voiceClock, voiceTurns, VOICE_HARD_MS, type Fragment } from './voice.policy';
import { VoiceProvider } from './voice.provider';
import { taraVerbalStop } from './voice-turns';

type Channel = ReturnType<VoiceProvider['attach']>;
type Captured = Required<Omit<Fragment, 'id'>>;
type Live = {
    channel: Channel; topics: TaraTopic[]; delivery: NativeDelivery;
    fragments: Fragment[]; queue: Captured[]; pending: Promise<void>;
    closed: boolean; finishing: boolean; ready?: boolean; nativeOutput?: boolean; captureFailed?: boolean; sidebandLost?: boolean;
    usage?: unknown; hardTimer?: ReturnType<typeof setTimeout>; openingTimer?: ReturnType<typeof setTimeout>; steering: Set<string>; delegated: boolean;
};
const terminal = ['ENDED', 'FAILED', 'CREATE_UNCERTAIN'];
const technical = (reason: string) => !['TIME_LIMIT', 'TARA_FINISHED', 'CANDIDATE_ENDED'].includes(reason);
const leaseMs = 60_000;
const mutedGapMs = 30_000;

@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
    private readonly owner = randomUUID();
    private readonly active = new Map<string, Live>();
    private readonly logger = new Logger(VoiceService.name);
    private timer?: ReturnType<typeof setInterval>;
    private ticking = false;

    constructor(private db: PrismaService, private config: ConfigService, private sessions: ScreeningSessions,
        private provider: VoiceProvider, private client: ScreeningClient) {}

    async onModuleInit() {
        const exists = await this.db.$queryRaw<Array<{name:string|null}>>`SELECT to_regclass('public."VoiceInterview"')::text AS name`.catch(() => []);
        if (!exists[0]?.name) return;
        this.timer = setInterval(() => void this.tick().catch(() => this.logger.warn('Voice watchdog retry pending.')), 1000);
        this.timer.unref();
    }

    async onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
        await Promise.allSettled([...this.active.keys()].map(id => this.finish(id, 'SERVER_RESTART')));
    }

    private async owned(user: AuthUser, id: string) {
        const row = await this.sessions.owned(user, id);
        if (row.invitation?.mode !== 'VOICE') throw new ForbiddenException('Undangan ini bukan interview suara.');
        return row;
    }

    private safe(row: VoiceInterview) {
        const live = this.active.get(row.id);
        const native = row.promptVersion === NATIVE_VOICE_VERSION;
        const started = live?.delivery.firstAudible;
        return {
            id: row.id, status: row.status, startedAt: started === undefined ? row.startedAt : new Date(started), endedAt: row.endedAt,
            serverNow: new Date(), warningAt: row.warningAt, closingAt: row.closingAt, closeReason: row.closeReason,
            transcriptComplete: row.transcriptComplete, error: row.error, voiceMode: native ? 'NATIVE' : 'HISTORICAL',
            model: row.model, clockRunning: started !== undefined || terminal.includes(row.status),
            ...(started === undefined ? {} : { deadlineAt: new Date(started + VOICE_HARD_MS) }),
        };
    }

    async state(user: AuthUser, id: string) {
        await this.owned(user, id);
        const row = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (!row) return null;
        const fragments = await this.db.voiceFragment.findMany({ where: { voiceId: row.id }, orderBy: { id: 'asc' } });
        return { ...this.safe(row), transcript: row.promptVersion === NATIVE_VOICE_VERSION ? nativeVoiceTurns(fragments) : voiceTurns(fragments) };
    }

    async create(user: AuthUser, id: string, clientId: string, sdp: string) {
        await this.owned(user, id);
        if (!screeningEnabled() || !this.provider.configured || this.config.get('TARA_NATIVE_VOICE_PAUSED') === 'true')
            throw new ServiceUnavailableException('Interview suara sedang tidak tersedia. Coba lagi nanti.');
        const existing = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (existing) throw new ConflictException(terminal.includes(existing.status) ? 'Sesi ini sudah berakhir. Hasilnya tetap disimpan.' : 'Sesi sudah dimulai di tab lain.');
        await this.sessions.claim(user, id, clientId);
        await this.sessions.start(user, id, clientId, 'VOICE');
        const session = await this.db.aiScreeningSession.findUniqueOrThrow({ where: { id }, include: { currentPlan: true, package: true } });
        if (session.status !== 'ACTIVE' || !session.currentPlan?.payload || !session.package?.payload)
            throw new ConflictException('Tara masih menyiapkan pertanyaan. Coba lagi sebentar.');
        requireCurrentConversation(session.package.conversationPolicy);
        const topics = taraTopics(session.currentPlan.payload as unknown as CandidatePayload, session.package.payload as unknown as PackagePayload, true);
        const lease = await this.db.aiScreeningSession.updateMany({ where: { id, leaseToken: clientId, status: 'ACTIVE' },
            data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        if (!lease.count) throw new ConflictException('Interview digunakan tab lain.');
        const request = createVoiceRequest(this.config.get<string>('TARA_LIVE_VOICE') ?? 'marin', sdp, topics);
        let row: VoiceInterview;
        try {
            row = await this.db.voiceInterview.create({ data: { sessionId: id, owner: this.owner, leaseUntil: new Date(Date.now() + 15_000),
                model: TARA_LIVE_MODEL, promptVersion: NATIVE_VOICE_VERSION, promptSnapshot: json({ instructions: request.session.instructions, mode: 'NATIVE' }),
                taraInterview: json(startTara(topics, true)) } });
        } catch (error) {
            if ((error as { code?: string })?.code !== 'P2002') throw error;
            throw new ConflictException('Interview sudah dimulai.');
        }

        let providerId: string | undefined;
        try {
            const response = await this.provider.create(request);
            providerId = response.session?.id;
            if (!providerId || !response.transport?.sdp) throw Error('VOICE_CREATE_INVALID');
            row = await this.db.voiceInterview.update({ where: { id: row.id }, data: { providerId, status: 'CONNECTING' } });
            const voiceId = row.id;
            const channel = this.provider.attach(providerId, event => this.accept(voiceId, event), () => {
                const live = this.active.get(voiceId);
                if (live && !live.closed) {
                    live.sidebandLost = true;
                    live.captureFailed = true;
                    this.logger.warn('Tara Live transcript connection lost');
                }
            });
            this.active.set(voiceId, { channel, topics, delivery: { sequence: 0, windows: [] }, fragments: [],
                queue: [], pending: Promise.resolve(), closed: false, finishing: false, steering: new Set(), delegated: false });
            await channel.opened;
            row = await this.db.voiceInterview.update({ where: { id: voiceId }, data: {
                status: 'ACTIVE', heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + 15_000) } });
            return { ...this.safe(row), sdp: response.transport.sdp };
        } catch (error) {
            if (!providerId && error instanceof Error && /^VOICE_PROVIDER_HTTP_/.test(error.message)) {
                await this.db.voiceInterview.deleteMany({ where: { id: row.id, providerId: null } });
                throw new ServiceUnavailableException('Koneksi suara belum tersedia. Silakan coba lagi sebentar.');
            }
            if (providerId) await this.finish(row.id, 'CONNECTION_FAILED');
            else await this.finalize(row.id, { status: 'CREATE_UNCERTAIN', endedAt: new Date(),
                error: 'Pembuatan koneksi belum terkonfirmasi. Hubungi HR untuk sesi baru.' });
            throw new ServiceUnavailableException('Koneksi interview belum berhasil. Hasil yang tersedia tetap tersimpan.');
        }
    }

    private accept(id: string, event: Record<string, unknown>) {
        const live = this.active.get(id);
        if (!live || live.closed) return;
        switch (event.type) {
            case 'session.started':
                live.delivery.origin ??= Date.now();
                return;
            case 'session.closed': {
                live.closed = true;
                live.usage = event.usage;
                const reason = event.reason === 'connection_lost' ? 'CONNECTION_LOST' : event.reason === 'remote_hangup' ? 'CANDIDATE_DISCONNECTED' :
                    event.reason === 'expired' ? 'TIME_LIMIT' : 'PROVIDER_ENDED';
                if (!live.finishing) this.requestFinish(id, reason);
                return;
            }
            case 'error':
                if (!live.finishing) this.logger.warn('Tara Live provider reported a control or media error');
                return;
            case 'session.delegation.created': {
                if (live.finishing || live.delegated) return;
                live.delegated = true;
                const delegation = event.delegation as { id?: unknown } | undefined;
                this.steer(live, 'unexpected-delegation', 'Lanjutkan sendiri sekarang. Gunakan percakapan yang sudah ada dan jangan menunggu pekerjaan lain.',
                    typeof delegation?.id === 'string' ? delegation.id : null);
                this.logger.warn('Tara Live attempted delegation without a backend model');
                return;
            }
            case 'session.input_transcript.delta':
            case 'session.output_transcript.delta': {
                const { event_id, delta, start_ms, end_ms } = event;
                if (typeof event_id !== 'string' || event_id.length > 256 || typeof delta !== 'string' || !delta ||
                    typeof start_ms !== 'number' || typeof end_ms !== 'number' || !Number.isInteger(start_ms) ||
                    !Number.isInteger(end_ms) || start_ms < 0 || end_ms <= start_ms || end_ms > VOICE_HARD_MS + NATIVE_STARTUP_MS) return;
                if (live.queue.length >= 512) { live.captureFailed = true; return; }
                if (event.type === 'session.output_transcript.delta') live.nativeOutput = true;
                live.queue.push({ eventId: event_id, text: delta.slice(0, 4000), startMs: start_ms, endMs: end_ms,
                    speaker: event.type === 'session.input_transcript.delta' ? 'CANDIDATE' : 'TARA' });
            }
        }
    }

    private flush(id: string, live: Live): Promise<void> {
        if (!live.queue.length) return live.pending;
        const batch = live.queue.splice(0);
        live.pending = live.pending.then(async () => {
            const fragments = await this.db.$transaction(async tx => {
                await tx.$queryRaw`SELECT id FROM "VoiceInterview" WHERE id=${id} FOR UPDATE`;
                const row = await tx.voiceInterview.findUnique({ where: { id }, select: { sessionId: true, closeReason: true } });
                if (!row?.sessionId || row.closeReason === 'ACCOUNT_ERASED') return [];
                return tx.voiceFragment.createManyAndReturn({ data: batch.map(fragment => ({ ...fragment, voiceId: id })), skipDuplicates: true });
            });
            live.fragments.push(...fragments);
        }).catch(() => {
            live.captureFailed = true;
            this.logger.warn('Tara Live could not persist a transcript batch');
        });
        return live.pending;
    }

    private steer(live: Live, key: string, content: string, delegationId: string | null = null, say = false) {
        if (live.closed || live.sidebandLost || live.steering.has(key)) return;
        live.steering.add(key);
        try {
            live.channel.send({ type: say ? 'session.commentary.append' : 'session.instructions.append',
                event_id: 'tara-' + key, delegation_id: delegationId, content });
        } catch { live.sidebandLost = true; live.captureFailed = true; }
    }

    async media(user: AuthUser, id: string, clientId: string, event: MediaSignal, sequence: number, delayMs: number, transcriptEventId?: string) {
        const session = await this.owned(user, id);
        const row = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (!row) throw new NotFoundException('Sesi suara tidak tersedia.');
        if (terminal.includes(row.status)) return this.safe(row);
        if (session.leaseToken !== clientId || !session.leaseExpiresAt || +session.leaseExpiresAt <= Date.now())
            throw new ConflictException('Tab interview tidak aktif.');
        const live = this.active.get(row.id);
        if (!live || live.finishing || live.closed || row.owner !== this.owner) throw new ConflictException('Koneksi Tara tidak aktif.');
        if (event !== 'READY' && !live.ready) throw new ConflictException('Pemutar suara belum siap.');
        const first = live.delivery.firstAudible === undefined;
        const now = Date.now();
        if (event === 'TEXT_SHOWN' && !live.queue.some(fragment => fragment.eventId === transcriptEventId && fragment.speaker === 'TARA') &&
            !live.fragments.some(fragment => fragment.eventId === transcriptEventId && fragment.speaker === 'TARA')) return this.safe(row);
        if (!recordMedia(live.delivery, event, sequence, Math.max(+row.createdAt, now - delayMs), transcriptEventId)) return this.safe(row);
        if (event === 'READY') {
            live.ready = true;
            live.delivery.origin ??= now;
            if (!live.openingTimer) {
                live.openingTimer = setTimeout(() => {
                    if (!live.finishing && !live.nativeOutput && live.delivery.firstAudible === undefined)
                        this.steer(live, 'opening', 'Buka interview sekarang dalam bahasa Indonesia dan ajukan pertanyaan pertama dari data wawancara. Setelah pertanyaan, beri kandidat waktu untuk menjawab.', null, true);
                }, 1500);
                live.openingTimer.unref();
            }
        }
        if (first && live.delivery.firstAudible !== undefined) {
            live.hardTimer = setTimeout(() => this.requestFinish(row.id, 'TIME_LIMIT'), Math.max(0, live.delivery.firstAudible + VOICE_HARD_MS - now));
            live.hardTimer.unref();
        }
        const delivery = json({ ...startTara(live.topics, true), nativeDelivery: live.delivery });
        const written = live.pending.then(() => this.db.voiceInterview.updateMany({ where: { id: row.id, sessionId: id,
            status: { in: ['ACTIVE', 'CLOSING'] }, owner: this.owner, OR: [{ closeReason: null }, { closeReason: { not: 'ACCOUNT_ERASED' } }] },
            data: { taraInterview: delivery, ...(first && live.delivery.firstAudible !== undefined ? { startedAt: new Date(live.delivery.firstAudible) } : {}) } }));
        // The audio track stays independent of this durable metadata write.
        live.pending = written.then(() => undefined).catch(() => { live.captureFailed = true; });
        await live.pending;
        return this.safe(row);
    }

    async heartbeat(user: AuthUser, id: string, clientId: string) {
        await this.owned(user, id);
        const voice = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (voice && terminal.includes(voice.status)) return this.safe(voice);
        const renewed = await this.db.aiScreeningSession.updateMany({ where: { id, leaseToken: clientId, status: 'ACTIVE' },
            data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        if (!renewed.count) throw new ConflictException('Interview digunakan tab lain.');
        await this.db.voiceInterview.updateMany({ where: { sessionId: id, status: { in: ['CONNECTING', 'ACTIVE', 'CLOSING'] } }, data: { heartbeatAt: new Date() } });
        return voice ? this.safe(voice) : null;
    }

    async end(user: AuthUser, id: string, clientId: string, reason = 'CANDIDATE_ENDED') {
        const session = await this.owned(user, id);
        const row = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (row && terminal.includes(row.status)) return this.state(user, id);
        if (session.leaseToken !== clientId) throw new ConflictException('Interview digunakan tab lain.');
        if (row) await this.finish(row.id, reason);
        return this.state(user, id);
    }

    async tick(now = new Date()) {
        if (this.ticking) return;
        this.ticking = true;
        try {
            const rows = await this.db.voiceInterview.findMany({ where: { status: { notIn: terminal } } });
            await Promise.allSettled(rows.map(row => this.watch(row, now)));
            const stranded = await this.db.voiceInterview.findMany({ where: { status: { in: terminal }, session: { status: { not: 'COMPLETED' } } }, take: 25 });
            for (const row of stranded) await this.finalize(row.id);
        } finally { this.ticking = false; }
    }

    private async watch(row: VoiceInterview, now: Date) {
        if (!row.sessionId) { await this.finish(row.id, 'ACCOUNT_ERASED'); return; }
        if (row.owner !== this.owner) {
            if (row.leaseUntil <= now) {
                const claimed = await this.db.voiceInterview.updateMany({ where: { id: row.id, owner: row.owner, leaseUntil: { lte: now } },
                    data: { owner: this.owner, leaseUntil: new Date(+now + 15_000) } });
                if (claimed.count) await this.finish(row.id, 'SERVER_RESTART');
            }
            return;
        }
        await this.db.voiceInterview.updateMany({ where: { id: row.id, owner: this.owner }, data: { leaseUntil: new Date(+now + 15_000) } });
        const live = this.active.get(row.id);
        if (live) void this.flush(row.id, live);
        const start = live?.delivery.firstAudible;
        const waiting = start === undefined && row.promptVersion === NATIVE_VOICE_VERSION;
        if (+now - +row.heartbeatAt > (waiting || row.status !== 'ACTIVE' ? NATIVE_STARTUP_MS : mutedGapMs)) {
            await this.finish(row.id, 'CANDIDATE_DISCONNECTED');
            return;
        }
        if (waiting) {
            if (+now - +row.createdAt >= NATIVE_STARTUP_MS) await this.finish(row.id, 'CONNECTION_FAILED');
            return;
        }
        const clock = voiceClock(start === undefined ? row.startedAt : new Date(start), now);
        if (clock.hard) { await this.finish(row.id, 'TIME_LIMIT'); return; }
        if (!live || live.closed || live.finishing) return;
        if (clock.warning && !row.warningAt)
            await this.db.voiceInterview.updateMany({ where: { id: row.id, warningAt: null }, data: { warningAt: now } });
        const turns = nativeVoiceTurns(live.fragments);
        const last = turns.at(-1);
        const signoff = live.delivery.open === undefined && last?.speaker === 'TARA' && /\binterview kita selesai ya\b/i.test(last.text);
        if (clock.closing) {
            if (!row.closingAt) {
                const changed = await this.db.voiceInterview.updateMany({ where: { id: row.id, status: 'ACTIVE', owner: this.owner },
                    data: { status: 'CLOSING', closingAt: now, closeReason: 'TIME_LIMIT' } });
                if (changed.count) this.steer(live, 'closing', 'Waktu pembahasan habis. Ucapkan “Makasih udah cerita. Interview kita selesai ya.” lalu berhenti.');
            } else if (signoff) await this.finish(row.id, 'TIME_LIMIT');
            return;
        }
        if (last?.speaker === 'CANDIDATE' && taraVerbalStop(last.text)) {
            await this.finish(row.id, 'CANDIDATE_ENDED'); return;
        }
        const next = nativeCoverage(live.topics, turns, live.delivery, clock.elapsed);
        if (next) {
            const ordered = live.topics.indexOf(next) + 1;
            this.steer(live, 'coverage-' + ordered, 'Tutup pembahasan dengan hangat. Lanjutkan sekarang ke topik nomor ' + ordered + ' dalam data wawancara.');
        } else if (signoff) {
            await this.finish(row.id, 'TARA_FINISHED');
        }
    }

    private requestFinish(id: string, reason: string) {
        void this.finish(id, reason).catch(() => this.logger.warn('Voice closure will retry.'));
    }

    async finish(id: string, reason: string) {
        const row = await this.db.voiceInterview.findUnique({ where: { id } });
        const live = this.active.get(id);
        if (!row || live?.finishing) return;
        if (live) live.finishing = true;
        try {
            if (terminal.includes(row.status)) {
                if (row.providerId && live && !live.closed) await this.provider.hangup(row.providerId);
                return;
            }
            const closeReason = row.closeReason === 'ACCOUNT_ERASED' ? row.closeReason : technical(reason) ? reason : row.closeReason ?? reason;
            await this.db.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } },
                data: { status: 'CLOSING', closeReason, closingAt: row.closingAt ?? new Date() } });
            if (live && !live.closed && !live.sidebandLost) {
                try { live.channel.send({ type: 'session.close' }); } catch { live.sidebandLost = true; }
                const until = Date.now() + (reason === 'TIME_LIMIT' ? 0 : 2500);
                while (!live.closed && !live.sidebandLost && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (row.providerId && !live?.closed) await this.provider.hangup(row.providerId);
            if (live) await this.flush(id, live);
            const start = live?.delivery.firstAudible;
            const endedAt = new Date(start === undefined ? Date.now() : Math.min(Date.now(), start + VOICE_HARD_MS));
            const complete = Boolean(live?.closed && !live.captureFailed && !technical(closeReason));
            const progress = row.sessionId && closeReason !== 'ACCOUNT_ERASED' && live ?
                nativeInterview(live.topics, nativeVoiceTurns(live.fragments), live.delivery, +endedAt, !complete).progress : undefined;
            await this.finalize(id, { status: 'ENDED', endedAt, closeReason, transcriptComplete: complete,
                ...(live?.usage ? { usage: json(live.usage) } : {}),
                ...(technical(closeReason) && closeReason !== 'ACCOUNT_ERASED' ? { error: 'Sesi suara terputus. Jawaban yang tersimpan tetap tersedia.' } : {}),
                ...(progress ? { taraInterview: json(progress) } : {}) });
        } catch {
            await this.db.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } },
                data: { error: 'Penutupan koneksi sedang dicoba ulang.', leaseUntil: new Date(0) } });
        } finally {
            const retained = await this.db.voiceInterview.findUnique({ where: { id }, select: { status: true } });
            if (!retained || terminal.includes(retained.status)) {
                if (live?.hardTimer) clearTimeout(live.hardTimer);
                if (live?.openingTimer) clearTimeout(live.openingTimer);
                live?.channel.dispose();
                this.active.delete(id);
            } else if (live) live.finishing = false;
        }
    }

    private async finalize(id: string, change?: Prisma.VoiceInterviewUpdateManyMutationInput) {
        await this.db.$transaction(async tx => {
            const snapshot = await tx.voiceInterview.findUnique({ where: { id }, select: { sessionId: true, endedAt: true, promptVersion: true } });
            const session = snapshot?.sessionId ? await tx.aiScreeningSession.findUnique({ where: { id: snapshot.sessionId }, include: { invitation: true } }) : null;
            if (session?.invitation) await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${session.invitation.id} FOR UPDATE`;
            if (change) {
                const { taraInterview, ...lifecycle } = change;
                await tx.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } }, data: lifecycle });
                if (taraInterview) await tx.voiceInterview.updateMany({ where: { id, sessionId: { not: null }, closeReason: { not: 'ACCOUNT_ERASED' } }, data: { taraInterview } });
            }
            if (!session?.invitation || !await tx.aiScreeningSession.findUnique({ where: { id: session.id } })) return;
            const current = await tx.voiceInterview.findUnique({ where: { id }, select: { sessionId: true, endedAt: true, promptVersion: true } });
            if (current?.sessionId !== session.id) return;
            await tx.aiScreeningSession.updateMany({ where: { id: session.id, status: { not: 'COMPLETED' } },
                data: { status: 'COMPLETED', completedAt: current.endedAt ?? new Date(), leaseToken: null, leaseExpiresAt: null } });
            await tx.screeningInvitation.updateMany({ where: { id: session.invitation.id, status: { not: 'CANCELLED' } }, data: { status: 'COMPLETED' } });
            await tx.aiScreeningEvaluation.upsert({ where: { sessionId: session.id },
                create: { sessionId: session.id, status: 'PENDING', promptVersion: current.promptVersion }, update: {} });
            await enqueueWork(tx, 'VOICE_EVALUATE', session.id);
        });
    }

    async evaluate(workId: string, sessionId: string, owner?: string) {
        const voice = await this.db.voiceInterview.findUnique({ where: { sessionId }, include: {
            fragments: { orderBy: { id: 'asc' } }, session: { include: { currentPlan: true, invitation: true, package: true, evaluation: true } },
        } });
        if (!voice || !terminal.includes(voice.status) || !voice.session?.invitation || !voice.session.currentPlan || !voice.session.package ||
            voice.session.evaluation?.result) return;
        const plan = voice.session.currentPlan.payload as unknown as CandidatePayload;
        const rubric = voice.session.package.payload as unknown as PackagePayload;
        const progress = voice.taraInterview as unknown as NativeProgress | null;
        const topics = taraTopics(plan, rubric, Boolean(progress?.policyVersion));
        const native = voice.promptVersion === NATIVE_VOICE_VERSION;
        const interrupted = technical(voice.closeReason ?? '') || !voice.transcriptComplete;
        const projection = native ? nativeInterview(topics, nativeVoiceTurns(voice.fragments),
            progress?.nativeDelivery ?? { sequence: 0, windows: [] }, +(voice.endedAt ?? voice.startedAt), interrupted) : undefined;
        const notes = projection ? taraInterviewReport(projection.progress, topics) : progress ? taraInterviewReport(progress, topics) : undefined;
        const turns = projection?.evidenceTurns ?? voiceTurns(voice.fragments);
        return evaluateTakaInterview(this.db, this.client, workId, voice.session, voice.session.invitation,
            frozenTakaInterview(voice.session.invitation.snapshot, (voice.session.package.promptSnapshot as unknown as PromptRegistry)?.takaInterview),
            plan, liveTakaTurns(turns, projection ? new Date(projection.origin) : voice.startedAt, voice.transcriptComplete, notes),
            { owner, notes, rubric, interrupted, voice: { closeReason: voice.closeReason, transcriptComplete: voice.transcriptComplete,
                durationSeconds: Math.max(0, Math.round((+(voice.endedAt ?? voice.startedAt) - +voice.startedAt) / 1000)) } });
    }
}
