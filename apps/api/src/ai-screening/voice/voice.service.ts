import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VoiceInterview } from '@prisma/client';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { requireCurrentConversation } from '../conversation.policy';
import { createVoiceRequest, TARA_LIVE_MODEL, TARA_LIVE_OPENING } from '../prompts/voice-session';
import type { PromptRegistry } from '../prompts/registry';
import { ScreeningClient } from '../screening.client';
import { enqueueWork } from '../screening-packets.service';
import { json, screeningEnabled } from '../screening.policy';
import type { CandidatePayload, PackagePayload } from '../screening.schemas';
import { ScreeningSessions } from '../screening-sessions.service';
import { evaluateTakaInterview } from '../taka-evaluation';
import { frozenTakaInterview, liveTakaTurns } from '../taka-interview';
import { startTara, taraInterviewReport, taraTopics, type TaraTopic } from '../tara-interview';
import { nativeInterview, nativeVoiceTurns, NATIVE_STARTUP_MS, NATIVE_VOICE_VERSION, recordMedia, reflectedVoiceSignal,
    type MediaSignal, type NativeDelivery, type NativeProgress } from './voice-native';
import { voiceClock, voiceTurns, VOICE_HARD_MS, type Fragment } from './voice.policy';
import { VoiceProvider } from './voice.provider';
import { frozenRoleRubric } from '../role-rubric';
import { directFarewellAt, isNativeVoice, roleVoiceEvidence, roleVoiceTurns, ROLE_VOICE_VERSION } from './voice-role';
import { roleLiveTranscript } from '../taka-role-assessment';
import { liveAgendaRubric } from '../tara-live-agenda';

type Channel = ReturnType<VoiceProvider['attach']>;
type Captured = Required<Omit<Fragment, 'id'>>;
type Live = {
    providerId: string; channel?: Channel; topics: TaraTopic[]; delivery: NativeDelivery;
    fragments: Fragment[]; queue: Captured[]; seen: Set<string>; pending: Promise<void>;
    closed: boolean; finishing: boolean; acceptedAt: number; providerStartedAt?: number; exchangeStarted?: boolean; openingSent?: boolean;
    captureFailed?: boolean; flushing?: Promise<void>; channelReady?: boolean; sidebandLostAt?: number; reattachAfter?: number;
    usage?: unknown; hardTimer?: ReturnType<typeof setTimeout>;
    candidateLastSpeechAt?: number;
    inputQuiet?: boolean; inputObservedAt?: number;
    unexpectedDelegation?: boolean; checkedPlaybackEnd?: number; checkedFragmentCount?: number; latestOutputEnd?: number;
    playbackObservedAt?: number; firstOutputReceivedAt?: number;
};
const terminal = ['ENDED', 'FAILED', 'CREATE_UNCERTAIN'];
const technical = (reason: string) => !['TIME_LIMIT', 'TARA_FINISHED', 'CANDIDATE_ENDED'].includes(reason);
const leaseMs = 60_000;
const openingGraceMs = 3_000;
const clockFallbackMs = 8_000;
const farewellGraceMs = 3_000;

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
        const native = isNativeVoice(row.promptVersion);
        const direct = row.promptVersion === TARA_LIVE_AUDIO_PROTOCOL;
        const started = live?.delivery.clockStartedAt;
        return {
            id: row.id, status: row.status, startedAt: started === undefined ? row.startedAt : new Date(started), endedAt: row.endedAt,
            serverNow: new Date(), warningAt: row.warningAt, closingAt: row.closingAt, closeReason: row.closeReason,
            transcriptComplete: row.transcriptComplete, error: row.error, voiceMode: native ? 'NATIVE' : 'HISTORICAL',
            model: row.model, clockRunning: started !== undefined || terminal.includes(row.status),
            ...(direct ? { audioProtocol: TARA_LIVE_AUDIO_PROTOCOL } : {}),
            ...(started === undefined ? {} : { deadlineAt: new Date(started + VOICE_HARD_MS) }),
        };
    }

    async state(user: AuthUser, id: string) {
        await this.owned(user, id);
        const row = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (!row) return null;
        const fragments = await this.db.voiceFragment.findMany({ where: { voiceId: row.id }, orderBy: { id: 'asc' } });
        const transcript = row.promptVersion === ROLE_VOICE_VERSION || row.promptVersion === TARA_LIVE_AUDIO_PROTOCOL ? roleVoiceTurns(fragments) :
            isNativeVoice(row.promptVersion) ? nativeVoiceTurns(fragments) : voiceTurns(fragments);
        return { ...this.safe(row), transcript };
    }

    async create(user: AuthUser, id: string, clientId: string, sdp: string, audioProtocol?: string) {
        await this.owned(user, id);
        if (audioProtocol !== TARA_LIVE_AUDIO_PROTOCOL) throw new ConflictException('Muat ulang halaman untuk memakai pemutar suara Tara terbaru.');
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
        const plan = session.currentPlan.payload as unknown as CandidatePayload;
        const packet = session.package.payload as unknown as PackagePayload;
        const topics = taraTopics(plan, packet, true).slice(0, 4).map<TaraTopic>(topic => {
            const claimId = plan.roleTopics?.find(row => row.criterionId === topic.criterionId)?.cvClaimId ?? topic.id;
            const claim = plan.claims.find(row => row.id === claimId && row.criterionId === topic.criterionId);
            const fields = new Set(topic.fields ?? []);
            if (claim?.scope === 'CONTEXTUAL') fields.add('CONTEXT');
            for (const evidence of claim?.extraEvidence ?? []) fields.add(evidence.field);
            return { ...topic, fields: [...fields], skill: claim?.skill };
        });
        const lease = await this.db.aiScreeningSession.updateMany({ where: { id, leaseToken: clientId, status: 'ACTIVE' },
            data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        if (!lease.count) throw new ConflictException('Interview digunakan tab lain.');
        const request = createVoiceRequest(this.config.get<string>('TARA_LIVE_VOICE') ?? 'marin', sdp, topics);
        let row: VoiceInterview;
        try {
            row = await this.db.voiceInterview.create({ data: { sessionId: id, owner: this.owner, leaseUntil: new Date(Date.now() + 15_000),
                model: TARA_LIVE_MODEL, promptVersion: TARA_LIVE_AUDIO_PROTOCOL,
                promptSnapshot: json({ instructions: request.session.instructions, mode: 'NATIVE', agendaRevision: packet.liveAgenda?.revision }),
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
            row = await this.db.voiceInterview.update({ where: { id: row.id, sessionId: id, owner: this.owner, status: 'CREATING' }, data: {
                providerId, status: 'ACTIVE', heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + 15_000) } });
            const live: Live = { providerId, topics, acceptedAt: Date.now(), delivery: { sequence: 0, windows: [] }, fragments: [], queue: [],
                seen: new Set(), pending: Promise.resolve(), closed: false, finishing: false, sidebandLostAt: Date.now() };
            this.active.set(row.id, live);
            this.attach(row.id, live);
            return { ...this.safe(row), sdp: response.transport.sdp };
        } catch (error) {
            if (!providerId && error instanceof Error && /^VOICE_PROVIDER_HTTP_/.test(error.message)) {
                await this.db.voiceInterview.deleteMany({ where: { id: row.id, providerId: null } });
                throw new ServiceUnavailableException('Koneksi suara belum tersedia. Silakan coba lagi sebentar.');
            }
            if (providerId) {
                if (row.providerId !== providerId) await this.provider.hangup(providerId).catch(() => this.logger.warn('Unattached Tara Live session could not be closed'));
                await this.finish(row.id, 'CONNECTION_FAILED');
            }
            else await this.finalize(row.id, { status: 'CREATE_UNCERTAIN', endedAt: new Date(),
                error: 'Pembuatan koneksi belum terkonfirmasi. Hubungi HR untuk sesi baru.' });
            throw new ServiceUnavailableException('Koneksi interview belum berhasil. Hasil yang tersedia tetap tersimpan.');
        }
    }

    private attach(id: string, live: Live) {
        const lost = () => {
            live.channelReady = false;
            live.channel = undefined;
            live.sidebandLostAt ??= Date.now();
            live.reattachAfter = Date.now() + 1000;
        };
        try {
            const channel = this.provider.attach(live.providerId, event => {
                if (live.channel === channel) this.accept(id, event);
            }, () => {
                if (live.channel !== channel) return;
                lost();
                channel.dispose();
                if (!live.finishing) this.logger.warn('Tara Live transcript connection lost');
            });
            live.channel = channel;
            void channel.opened.then(() => {
                if (live.channel !== channel) return;
                live.channelReady = true;
                if (live.sidebandLostAt !== undefined && Date.now() - live.sidebandLostAt > 3000 && live.delivery.readyAt !== undefined) live.captureFailed = true;
                live.sidebandLostAt = undefined;
            }).catch(() => {
                if (live.channel !== channel) return;
                lost();
                channel.dispose();
            });
        } catch {
            lost();
        }
    }

    private accept(id: string, event: Record<string, unknown>) {
        const live = this.active.get(id);
        if (!live || live.closed) return;
        switch (event.type) {
            case 'session.started':
                live.providerStartedAt ??= Date.now();
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
            case 'session.delegation.created':
                if (!live.unexpectedDelegation) this.logger.warn('Tara Live attempted delegation without a backend model');
                live.unexpectedDelegation = true;
                return;
            case 'session.output_audio.delta': {
                const start = event.start_ms;
                const end = event.end_ms;
                // Silence in reflected packets cannot anchor browser playback or count as a greeting.
                if (typeof start === 'number' && typeof end === 'number' && Number.isInteger(start) &&
                    Number.isInteger(end) && start >= 0 && end > start && end <= VOICE_HARD_MS + NATIVE_STARTUP_MS &&
                    reflectedVoiceSignal(event.delta)) {
                    live.exchangeStarted = true;
                    if (live.delivery.firstAudioMs === undefined) {
                        live.delivery.firstAudioMs = start;
                        live.firstOutputReceivedAt = Date.now();
                    }
                    live.latestOutputEnd = Math.max(live.latestOutputEnd ?? 0, end);
                }
                return;
            }
            case 'session.input_transcript.delta':
            case 'session.output_transcript.delta': {
                const { event_id, delta, start_ms, end_ms } = event;
                if (typeof event_id !== 'string' || event_id.length > 256 || typeof delta !== 'string' || !delta ||
                    typeof start_ms !== 'number' || typeof end_ms !== 'number' || !Number.isInteger(start_ms) ||
                    !Number.isInteger(end_ms) || start_ms < 0 || end_ms <= start_ms || end_ms > VOICE_HARD_MS + NATIVE_STARTUP_MS) return;
                if (live.seen.has(event_id)) return;
                live.exchangeStarted = true;
                if (event.type === 'session.input_transcript.delta') live.candidateLastSpeechAt = Date.now();
                if (live.queue.length >= 1024 || live.seen.size >= 30_000) { live.captureFailed = true; return; }
                live.seen.add(event_id);
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
            if (live.queue.length + batch.length <= 1024) live.queue.unshift(...batch);
            else live.captureFailed = true;
            this.logger.warn('Tara Live could not persist a transcript batch');
        });
        return live.pending;
    }

    private openConversation(live: Live, now: number) {
        const ready = live.delivery.playbackReadyAt;
        if (ready === undefined || now - ready < openingGraceMs || !live.channelReady || live.providerStartedAt === undefined ||
            live.sidebandLostAt !== undefined || live.captureFailed || live.exchangeStarted || live.openingSent || live.inputQuiet !== true ||
            live.delivery.firstAudible !== undefined || live.candidateLastSpeechAt !== undefined ||
            now - (live.inputObservedAt ?? 0) > 5000) return;
        live.openingSent = true;
        try {
            live.channel?.send({ type: 'session.commentary.append', event_id: 'tara-opening', delegation_id: null, content: TARA_LIVE_OPENING });
        } catch { this.logger.warn('Tara Live startup greeting could not be requested'); }
    }

    private startClock(id: string, live: Live, at: number, now: number) {
        if (live.delivery.clockStartedAt !== undefined) return false;
        live.delivery.clockStartedAt = at;
        live.hardTimer = setTimeout(() => this.requestFinish(id, 'TIME_LIMIT'), Math.max(0, at + VOICE_HARD_MS - now));
        live.hardTimer.unref();
        return true;
    }

    async media(user: AuthUser, id: string, clientId: string, event: MediaSignal, sequence: number, delayMs: number) {
        const session = await this.owned(user, id);
        const row = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (!row) throw new NotFoundException('Sesi suara tidak tersedia.');
        if (terminal.includes(row.status)) return this.safe(row);
        if (session.leaseToken !== clientId || !session.leaseExpiresAt || +session.leaseExpiresAt <= Date.now())
            throw new ConflictException('Tab interview tidak aktif.');
        const live = this.active.get(row.id);
        if (!live || live.finishing || live.closed || row.owner !== this.owner) throw new ConflictException('Koneksi Tara tidak aktif.');
        const now = Date.now();
        if (delayMs >= 2500 && event !== 'READY') {
            if (event === 'INPUT_ACTIVE' || event === 'INPUT_QUIET') live.inputQuiet = undefined;
            return this.safe(row);
        }
        const at = Math.max(+row.createdAt, now - delayMs);
        if (!recordMedia(live.delivery, event, sequence, at)) return this.safe(row);
        if (event === 'INPUT_ACTIVE' || event === 'INPUT_QUIET') {
            live.inputObservedAt = at;
            live.inputQuiet = event === 'INPUT_QUIET';
            if (!live.inputQuiet) {
                live.candidateLastSpeechAt = Math.max(live.candidateLastSpeechAt ?? 0, at);
                live.exchangeStarted = true;
            }
            return this.safe(row);
        }
        let clockStarted = false;
        if (event === 'AUDIBLE') {
            live.exchangeStarted = true;
            live.delivery.playbackVerified ??= Boolean(live.channelReady && !live.captureFailed && live.firstOutputReceivedAt !== undefined &&
                Math.abs(at - live.firstOutputReceivedAt) <= 1500);
            clockStarted = this.startClock(row.id, live, at, now);
        }
        if (event === 'AUDIBLE' || event === 'QUIET' || event === 'INTERRUPTED') live.playbackObservedAt = now;
        const delivery = json({ ...startTara(live.topics, true), nativeDelivery: live.delivery });
        const written = live.pending.then(() => this.db.voiceInterview.updateMany({ where: { id: row.id, sessionId: id,
            status: { in: ['ACTIVE', 'CLOSING'] }, owner: this.owner, OR: [{ closeReason: null }, { closeReason: { not: 'ACCOUNT_ERASED' } }] },
            data: { taraInterview: delivery, ...(clockStarted ? { startedAt: new Date(at) } : {}) } }));
        // The audio track stays independent of this durable metadata write.
        live.pending = written.then(() => undefined).catch(() => { live.captureFailed = true; });
        return this.safe(row);
    }

    async heartbeat(user: AuthUser, id: string, clientId: string, connected = false) {
        await this.owned(user, id);
        const voice = await this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        if (voice && terminal.includes(voice.status)) return this.safe(voice);
        const renewed = await this.db.aiScreeningSession.updateMany({ where: { id, leaseToken: clientId, status: 'ACTIVE' },
            data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        if (!renewed.count) throw new ConflictException('Interview digunakan tab lain.');
        const now = new Date();
        await this.db.voiceInterview.updateMany({ where: { sessionId: id, status: { in: ['CONNECTING', 'ACTIVE', 'CLOSING'] } }, data: { heartbeatAt: now } });
        const live = voice && this.active.get(voice.id);
        if (connected && live) live.delivery.readyAt ??= +now;
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
        const startupDeadline = +row.createdAt + NATIVE_STARTUP_MS;
        if (row.status === 'CLOSING') { await this.finish(row.id, row.closeReason ?? 'CONNECTION_LOST'); return; }
        if (+now >= startupDeadline && !live && !row.providerId) { await this.finish(row.id, 'CONNECTION_FAILED'); return; }
        if (!live || live.closed || live.finishing) return;
        if (!live.channel && +now >= (live.reattachAfter ?? 0)) this.attach(row.id, live);
        // A slow transcript write must not hold the lifecycle or the media connection.
        if (!live.flushing && live.queue.length)
            live.flushing = this.flush(row.id, live).finally(() => { live.flushing = undefined; });

        // Missing diagnostics do not establish that WebRTC has disconnected.
        const ready = live.delivery.readyAt ?? live.providerStartedAt ??
            (live.exchangeStarted || +now >= live.acceptedAt + NATIVE_STARTUP_MS ? live.acceptedAt : undefined);
        this.openConversation(live, +now);
        if (ready !== undefined && +now >= ready + clockFallbackMs && this.startClock(row.id, live, ready, +now)) {
            await this.db.voiceInterview.updateMany({ where: { id: row.id, status: 'ACTIVE', owner: this.owner },
                data: { startedAt: new Date(ready) } });
        }
        const started = live.delivery.clockStartedAt;
        if (started === undefined) return;
        const clock = voiceClock(new Date(started), now);
        if (clock.hard) { await this.finish(row.id, 'TIME_LIMIT'); return; }
        if (clock.warning && !row.warningAt)
            await this.db.voiceInterview.updateMany({ where: { id: row.id, warningAt: null }, data: { warningAt: now } });

        if (live.captureFailed || !live.channelReady || live.queue.length || live.flushing || live.inputQuiet !== true ||
            +now - (live.inputObservedAt ?? 0) > 5000) return;
        const played = live.delivery.windows.at(-1);
        if (!played || played.interrupted || live.delivery.open !== undefined ||
            played.end === live.checkedPlaybackEnd && live.fragments.length === live.checkedFragmentCount ||
            +now - (live.playbackObservedAt ?? played.end) < farewellGraceMs) return;
        if (live.latestOutputEnd !== undefined && live.delivery.firstAudible !== undefined && live.delivery.firstAudioMs !== undefined &&
            live.delivery.firstAudible - live.delivery.firstAudioMs + live.latestOutputEnd > played.end + 350) return;
        const farewell = directFarewellAt(live.fragments, live.delivery);
        if (farewell !== undefined && (live.candidateLastSpeechAt ?? 0) < farewell) {
            await this.finish(row.id, 'TARA_FINISHED');
        } else {
            live.checkedPlaybackEnd = played.end;
            live.checkedFragmentCount = live.fragments.length;
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
            if (live?.channelReady && !live.closed) {
                try { live.channel?.send({ type: 'session.close' }); } catch { live.channelReady = false; }
                const until = Date.now() + (reason === 'TIME_LIMIT' ? 0 : 2500);
                while (!live.closed && live.channelReady && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (row.providerId && !live?.closed) await this.provider.hangup(row.providerId);
            if (live) {
                await live.flushing;
                await this.flush(id, live);
                if (live.queue.length) await this.flush(id, live);
            }
            const start = live?.delivery.clockStartedAt;
            const endedAt = new Date(start === undefined ? Date.now() : Math.min(Date.now(), start + VOICE_HARD_MS));
            const complete = Boolean(live?.closed && !live.queue.length && live.sidebandLostAt === undefined && !live.captureFailed && !technical(closeReason));
            const progress = row.sessionId && closeReason !== 'ACCOUNT_ERASED' && live
                ? { ...startTara(live.topics, true), nativeDelivery: live.delivery, stage: 'DONE',
                    endedReason: !complete ? 'INTERRUPTED' : closeReason === 'TIME_LIMIT' ? 'TIME_LIMIT' : 'COMPLETE' }
                : undefined;
            await this.finalize(id, { status: 'ENDED', endedAt, closeReason, transcriptComplete: complete,
                ...(live?.usage ? { usage: json(live.usage) } : {}),
                error: technical(closeReason) && closeReason !== 'ACCOUNT_ERASED'
                    ? 'Sesi suara terputus. Jawaban yang tersimpan tetap tersedia.' : null,
                ...(progress ? { taraInterview: json(progress) } : {}) });
        } catch {
            await this.db.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } },
                data: { error: 'Penutupan koneksi sedang dicoba ulang.', leaseUntil: new Date(0) } });
        } finally {
            const retained = await this.db.voiceInterview.findUnique({ where: { id }, select: { status: true } });
            if (!retained || terminal.includes(retained.status)) {
                if (live?.hardTimer) clearTimeout(live.hardTimer);
                live?.channel?.dispose();
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
        const direct = voice.promptVersion === TARA_LIVE_AUDIO_PROTOCOL;
        const topics = taraTopics(plan, rubric, Boolean(progress?.policyVersion));
        const interrupted = technical(voice.closeReason ?? '') || !voice.transcriptComplete;
        const delivery = progress?.nativeDelivery ?? { sequence: 0, windows: [] };
        const roleRubric = direct || voice.promptVersion === ROLE_VOICE_VERSION ? frozenRoleRubric(voice.session.package.jobSnapshot) : undefined;
        const role = roleRubric ? { rubric: direct ? liveAgendaRubric(roleRubric, rubric.liveAgenda) : roleRubric, transcript: roleLiveTranscript(
            roleVoiceEvidence(voice.fragments, delivery, progress?.roleControl, direct).evidence, interrupted, direct),
            ...(direct ? { direct } : {}) } : undefined;
        const legacyTopics = direct ? topics.slice(0, 4) : topics;
        const projection = !role && (direct || voice.promptVersion === NATIVE_VOICE_VERSION) ? nativeInterview(legacyTopics,
            direct ? roleVoiceTurns(voice.fragments) : nativeVoiceTurns(voice.fragments), delivery, +(voice.endedAt ?? voice.startedAt), interrupted, direct) : undefined;
        const notes = projection ? taraInterviewReport(projection.progress, legacyTopics) : !role && progress ? taraInterviewReport(progress, topics) : undefined;
        const turns = direct ? roleVoiceTurns(voice.fragments) : projection?.evidenceTurns ?? voiceTurns(voice.fragments);
        return evaluateTakaInterview(this.db, this.client, workId, voice.session, voice.session.invitation,
            frozenTakaInterview(voice.session.invitation.snapshot, (voice.session.package.promptSnapshot as unknown as PromptRegistry)?.takaInterview),
            plan, role ? [] : liveTakaTurns(turns, projection ? new Date(projection.origin) : voice.startedAt, voice.transcriptComplete, notes),
            { owner, notes, rubric, interrupted, role, voice: { closeReason: voice.closeReason, transcriptComplete: voice.transcriptComplete,
                durationSeconds: Math.max(0, Math.round((+(voice.endedAt ?? voice.startedAt) - +voice.startedAt) / 1000)) } });
    }
}
