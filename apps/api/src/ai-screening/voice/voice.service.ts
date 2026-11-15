import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VoiceInterview } from '@prisma/client';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { requireCurrentConversation } from '../conversation.policy';
import { createVoiceRequest, TARA_LIVE_MODEL, type FrozenLiveVoicePrompt } from '../prompts/voice-session';
import type { PromptRegistry } from '../prompts/registry';
import { AiPending, ScreeningClient } from '../screening.client';
import { enqueueWork } from '../screening-packets.service';
import { json, screeningEnabled } from '../screening.policy';
import type { CandidatePayload, PackagePayload } from '../screening.schemas';
import { ScreeningSessions } from '../screening-sessions.service';
import { evaluateTakaInterview } from '../taka-evaluation';
import { frozenTakaInterview, liveTakaTurns } from '../taka-interview';
import { startTara, taraInterviewReport, taraTopics, type TaraProgress } from '../tara-interview';
import { nativeInterview, nativeVoiceTurns, NATIVE_STARTUP_MS, NATIVE_VOICE_VERSION, recordMedia, reflectedVoiceSignal,
    type MediaSignal, type NativeDelivery, type NativeProgress } from './voice-native';
import { voiceClock, voiceTurns, VOICE_HARD_MS, type Fragment } from './voice.policy';
import { VoiceCreationRejected, VoiceProvider } from './voice.provider';
import { VoiceTranscriptJournal } from './voice-transcript-journal';
import { alignedRoleFromPacket, ROLE_ASSESSMENT_VERSION } from '../role-rubric';
import { directFarewellAt, isNativeVoice, roleAssessmentVoiceEvidence, roleVoiceEvidence, roleVoiceTurns, ROLE_VOICE_VERSION } from './voice-role';
import { roleLiveTranscript } from '../taka-role-assessment';
import { liveAgendaRubric, liveInterviewTopics } from '../tara-live-agenda';
import { takaReassessment, takaVoiceInput } from '../taka-reassessment';
import { canResumeLive, expireLiveContinuations, liveAssessmentTranscript, liveCompletion, liveEvaluationKey, liveResumeHistory, liveTranscript,
    LIVE_CLOSE_RESERVE_MS, LIVE_DEEPEN_MS, LIVE_EVALUATION_WORK, LIVE_RESUME_MINIMUM_MS, LIVE_RESUME_WINDOW_MS,
    newLiveCompletion, reconcileLiveEvaluations, reportedVoiceMs, usesLiveCompletion, voiceBudgetAfterClose, type LiveCompletion } from './voice-completion';

type Channel = ReturnType<VoiceProvider['attach']>;
type Captured = Required<Omit<Fragment, 'id'>>;
type Live = {
    providerId: string; channel?: Channel; taraProgress: TaraProgress; delivery: NativeDelivery; opening?: string;
    fragments: Fragment[]; queue: Captured[]; writingTranscript?: Captured[]; seen: Set<string>; pending: Promise<void>;
    backupChannel?: Channel; backupReady?: boolean; nextBackupAttachAt?: number; transcriptDrainUntil?: number; closingWithFallback?: boolean;
    closed: boolean; finishing: boolean; acceptedAt: number; providerStartedAt?: number; exchangeStarted?: boolean; openingSent?: boolean;
    openingTimer?: ReturnType<typeof setTimeout>;
    captureFailed?: boolean; flushing?: Promise<void>; flushTimer?: ReturnType<typeof setTimeout>;
    channelReady?: boolean; sidebandLostAt?: number; reattachAfter?: number;
    captureGaps?: Array<{ start: number; end?: number; reason: string }>;
    usage?: unknown; observedVoiceMs?: number;
    hardTimer?: ReturnType<typeof setTimeout>; requestedClose?: string;
    providerClose?: ReturnType<VoiceProvider['closeWebRtc']>; closingReceipt?: { usage: unknown };
    candidateLastSpeechAt?: number;
    inputQuiet?: boolean; inputObservedAt?: number; lastInputAudioAt?: number;
    unexpectedDelegation?: boolean; checkedPlaybackEnd?: number; checkedFragmentCount?: number; latestOutputEnd?: number;
    playbackObservedAt?: number; firstOutputReceivedAt?: number; mediaObservedAt?: number; disconnectedAt?: number; playbackBlockedAt?: number;
    completion?: { sessionId: string; connectionId: string; deadlineAt?: number; startedAt?: number; usedVoiceMs: number };
};
type VoiceSessionState = { voiceCompletion: unknown; voiceDeadlineAt: Date | null; revision: number };
const terminal = ['ENDED', 'FAILED', 'CREATE_UNCERTAIN'];
const technical = (reason: string) => !['TIME_LIMIT', 'TARA_FINISHED', 'CANDIDATE_ENDED', 'CANDIDATE_PAUSED'].includes(reason);
const leaseMs = 60_000;
const recorderLeaseMs = 15_000;
const mediaHeartbeatFreshMs = 16_000;
const openingGraceMs = 3_000;
const managedOpeningGraceMs = 900;
const openingInputQuietMs = 750;
const clockFallbackMs = 8_000;
const farewellGraceMs = 3_000;
const redundantTranscriptDrainMs = 400;
const connectionOrder = [{ connectionNumber: 'desc' }, { createdAt: 'desc' }] satisfies Prisma.VoiceInterviewOrderByWithRelationInput[];
const connectionScope = (id: string) => ({ OR: [{ sessionId: id }, { resumedForId: id }] });

function transcriptDelta(event: Record<string, unknown>): Captured | undefined {
    const { type, event_id, delta, start_ms, end_ms } = event;
    if ((type !== 'session.input_transcript.delta' && type !== 'session.output_transcript.delta') ||
        typeof event_id !== 'string' || event_id.length > 256 || typeof delta !== 'string' || !delta ||
        typeof start_ms !== 'number' || typeof end_ms !== 'number' || !Number.isInteger(start_ms) || !Number.isInteger(end_ms) ||
        start_ms < 0 || end_ms <= start_ms || end_ms > VOICE_HARD_MS + NATIVE_STARTUP_MS) return;
    return { eventId: event_id, text: delta.slice(0, 4000), startMs: start_ms, endMs: end_ms,
        speaker: type === 'session.input_transcript.delta' ? 'CANDIDATE' : 'TARA' };
}

@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
    private readonly owner = randomUUID();
    private readonly active = new Map<string, Live>();
    private readonly logger = new Logger(VoiceService.name);
    private timer?: ReturnType<typeof setInterval>;
    private ticking = false;
    private nextEvaluationCheck = 0;
    private readonly journal?: VoiceTranscriptJournal;

    constructor(private db: PrismaService, private config: ConfigService, private sessions: ScreeningSessions,
        private provider: VoiceProvider, private client: ScreeningClient) {
        const directory = this.config.get<string>('TARA_TRANSCRIPT_JOURNAL_DIR');
        if (directory) this.journal = new VoiceTranscriptJournal(directory);
    }

    async onModuleInit() {
        const exists = await this.db.$queryRaw<Array<{name:string|null}>>`SELECT to_regclass('public."VoiceInterview"')::text AS name`.catch(() => []);
        if (!exists[0]?.name) return;
        this.timer = setInterval(() => void this.tick().catch(() => this.logger.warn('Voice watchdog retry pending.')), 1000);
        this.timer.unref();
    }

    async onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
        await Promise.allSettled([...this.active].map(async ([id, live]) => {
            if (live.finishing) return;
            const row = await this.db.voiceInterview.findUnique({ where: { id }, select: { owner: true } }).catch(() => null);
            if (row && row.owner !== this.owner) await this.releaseRecorder(id, live);
            else await this.finish(id, 'SERVER_RESTART');
        }));
    }

    private async owned(user: AuthUser, id: string) {
        const row = await this.sessions.owned(user, id);
        if (row.invitation?.mode !== 'VOICE') throw new ForbiddenException('Undangan ini bukan interview suara.');
        return row;
    }

    private safe(row: VoiceInterview, session?: VoiceSessionState) {
        const live = this.active.get(row.id);
        const native = isNativeVoice(row.promptVersion);
        const direct = row.promptVersion === TARA_LIVE_AUDIO_PROTOCOL;
        const started = live?.delivery.clockStartedAt;
        const completion = liveCompletion(session?.voiceCompletion);
        const ended = terminal.includes(row.status);
        const deadlineAt = ended && completion?.remainingVoiceMs !== undefined ? undefined :
            live?.completion?.deadlineAt ?? (session?.voiceDeadlineAt ? +session.voiceDeadlineAt : undefined) ??
            (started === undefined ? undefined : started + VOICE_HARD_MS);
        const remainingVoiceMs = completion && (ended ? completion.remainingVoiceMs :
            Math.max(0, deadlineAt === undefined ? row.reservedVoiceMs ?? completion.remainingVoiceMs ?? VOICE_HARD_MS : deadlineAt - Date.now()));
        return {
            id: row.id, status: row.status, startedAt: started === undefined ? row.startedAt : new Date(started), endedAt: row.endedAt,
            serverNow: new Date(), warningAt: row.warningAt, closingAt: row.closingAt, closeReason: row.closeReason,
            transcriptComplete: row.transcriptComplete, error: row.error, voiceMode: native ? 'NATIVE' : 'HISTORICAL',
            model: row.model, clockRunning: deadlineAt !== undefined || !completion && terminal.includes(row.status),
            ...(direct ? { audioProtocol: TARA_LIVE_AUDIO_PROTOCOL } : {}),
            ...(deadlineAt === undefined ? {} : { deadlineAt: new Date(deadlineAt) }),
            ...(completion ? { remainingVoiceMs, resumeUntil: completion.resumeExpiresAt, completion: { status: completion.status,
                evidenceRevision: completion.evidenceRevision, revision: session?.revision, reason: completion.reason,
                canResume: canResumeLive(completion, deadlineAt === undefined ? null : new Date(deadlineAt)) },
                connectionId: row.id, connectionNumber: row.connectionNumber } : {}),
        };
    }

    async state(user: AuthUser, id: string) {
        const session = await this.owned(user, id);
        const row = await this.connection(id, session);
        if (!row) return null;
        if (liveCompletion(session.voiceCompletion)) {
            const connections = await this.db.voiceInterview.findMany({ where: connectionScope(id),
                include: { fragments: { orderBy: { id: 'asc' } } }, orderBy: { connectionNumber: 'asc' } });
            return { ...this.safe(row, session), transcript: liveTranscript(connections) };
        }
        const fragments = await this.db.voiceFragment.findMany({ where: { voiceId: row.id }, orderBy: { id: 'asc' } });
        const transcript = row.promptVersion === ROLE_VOICE_VERSION || row.promptVersion === TARA_LIVE_AUDIO_PROTOCOL ? roleVoiceTurns(fragments) :
            isNativeVoice(row.promptVersion) ? nativeVoiceTurns(fragments) : voiceTurns(fragments);
        return { ...this.safe(row), transcript };
    }

    private async connection(id: string, session: VoiceSessionState) {
        if (!liveCompletion(session.voiceCompletion)) return this.db.voiceInterview.findUnique({ where: { sessionId: id } });
        return this.db.voiceInterview.findFirst({ where: connectionScope(id), orderBy: connectionOrder });
    }

    async create(user: AuthUser, id: string, clientId: string, sdp: string, audioProtocol?: string, attemptKey?: string) {
        const owned = await this.owned(user, id);
        if (audioProtocol !== TARA_LIVE_AUDIO_PROTOCOL) throw new ConflictException('Muat ulang halaman untuk memakai pemutar suara Tara terbaru.');
        if (!screeningEnabled() || !this.provider.configured || this.config.get('TARA_NATIVE_VOICE_PAUSED') === 'true')
            throw new ServiceUnavailableException('Interview suara sedang tidak tersedia. Coba lagi nanti.');
        const managed = usesLiveCompletion(owned.invitation?.snapshot);
        const existing = await this.connection(id, owned);
        const resume = Boolean(managed && existing && terminal.includes(existing.status) &&
            liveCompletion(owned.voiceCompletion)?.status === 'RESUMABLE');
        if (managed && attemptKey && await this.db.voiceInterview.count({ where: { ...connectionScope(id), attemptKey } }))
            throw new ConflictException('Permintaan koneksi ini sudah diproses. Periksa status wawancara.');
        if (existing && !resume) throw new ConflictException(terminal.includes(existing.status) ? 'Sesi ini sudah berakhir. Hasilnya tetap disimpan.' : 'Sesi sudah dimulai di tab lain.');
        if (!resume) {
            await this.sessions.claim(user, id, clientId);
            await this.sessions.start(user, id, clientId, 'VOICE');
        }
        const session = await this.db.aiScreeningSession.findUniqueOrThrow({ where: { id }, include: { currentPlan: true, package: true } });
        if (session.status !== 'ACTIVE' || !session.currentPlan?.payload || !session.package?.payload)
            throw new ConflictException('Tara masih menyiapkan pertanyaan. Coba lagi sebentar.');
        requireCurrentConversation(session.package.conversationPolicy);
        const plan = session.currentPlan.payload as unknown as CandidatePayload;
        const packet = session.package.payload as unknown as PackagePayload;
        const baseRubric = managed ? alignedRoleFromPacket(session.package.jobSnapshot, packet) : undefined;
        const rubric = baseRubric && liveAgendaRubric(baseRubric, packet.liveAgenda);
        if (managed && !rubric?.interviewIds.length) throw new ConflictException('Agenda wawancara belum tersedia.');
        const completion = liveCompletion(session.voiceCompletion);
        const topics = liveInterviewTopics(plan, packet, rubric);
        const voiceMs = completion?.remainingVoiceMs ?? VOICE_HARD_MS;
        if (managed && topics.length !== rubric?.interviewIds.length)
            throw new ConflictException('Agenda wawancara belum lengkap. Periksa persiapan undangan.');
        if (!managed) {
            const lease = await this.db.aiScreeningSession.updateMany({ where: { id, leaseToken: clientId, status: 'ACTIVE' },
                data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
            if (!lease.count) throw new ConflictException('Interview digunakan tab lain.');
        }
        const previousConnections = resume ? await this.db.voiceInterview.findMany({
            where: { ...connectionScope(id), status: { in: terminal } }, orderBy: { connectionNumber: 'asc' },
            include: { fragments: { orderBy: { id: 'asc' } } },
        }) : [];
        const coverageReview = completion?.assessedEvidenceRevision === undefined ? undefined :
            completion.assessedEvidenceRevision === completion.evidenceRevision ? 'CURRENT' : 'EARLIER';
        const request = createVoiceRequest(this.config.get<string>('TARA_LIVE_VOICE') ?? 'marin', sdp, topics, user.fullName, managed ? {
            prompt: (owned.invitation?.snapshot as { liveVoicePrompt?: FrozenLiveVoicePrompt } | null)?.liveVoicePrompt,
            ...(resume ? { remainingSeconds: Math.ceil(voiceMs / 1000), history: liveResumeHistory(previousConnections),
                missingCriterionIds: completion?.missingCriterionIds,
                coverageReview,
                assessedCriterionIds: completion?.retained?.map(([criterionId]) => criterionId) } : {}),
        } : undefined);
        const reservedAt = Date.now();
        const activeDeadlineAt = reservedAt + voiceMs;
        const taraProgress = startTara(topics, true);
        const data = {
            ...(resume ? { resumedForId: id, connectionNumber: existing!.connectionNumber + 1 } : { sessionId: id }),
            ...(managed ? { attemptKey, reservedVoiceMs: voiceMs } : {}), owner: this.owner, leaseUntil: new Date(reservedAt + 30_000),
            model: TARA_LIVE_MODEL, promptVersion: TARA_LIVE_AUDIO_PROTOCOL,
            promptSnapshot: json({ instructions: request.session.instructions, mode: 'NATIVE', agendaRevision: packet.liveAgenda?.revision,
                topicOrder: topics.map(topic => topic.id), ...(managed ? { completion: true } : {}) }),
            taraInterview: json(taraProgress),
        };
        let row: VoiceInterview;
        try {
            row = managed ? await this.db.$transaction(async tx => {
                await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${owned.invitation!.id} FOR UPDATE`;
                await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`;
                const current = await tx.aiScreeningSession.findUniqueOrThrow({ where: { id }, include: { invitation: true } });
                const prior = liveCompletion(current.voiceCompletion);
                const now = Date.now();
                const leased = current.leaseExpiresAt && +current.leaseExpiresAt > now;
                const cannotClaim = resume ? leased && current.leaseToken !== clientId : !leased || current.leaseToken !== clientId;
                if (current.status !== 'ACTIVE' || current.invitation?.status !== 'STARTED' || cannotClaim ||
                    current.revision !== session.revision || resume && (!prior || !canResumeLive(prior, current.voiceDeadlineAt, now)) ||
                    !resume && prior?.status !== undefined && prior.status !== 'IN_PROGRESS')
                    throw new ConflictException('Status wawancara berubah. Muat ulang sebelum melanjutkan.');
                const created = await tx.voiceInterview.create({ data });
                const next: LiveCompletion = { ...(prior ?? newLiveCompletion()), status: 'IN_PROGRESS', reason: undefined,
                    usedVoiceMs: prior?.usedVoiceMs ?? 0, remainingVoiceMs: voiceMs, activeConnectionId: created.id };
                await tx.aiScreeningSession.update({ where: { id }, data: {
                    voiceCompletion: json(next), voiceDeadlineAt: new Date(activeDeadlineAt), revision: { increment: 1 },
                    leaseToken: clientId, leaseExpiresAt: new Date(now + leaseMs),
                } });
                return created;
            }) : await this.db.voiceInterview.create({ data });
        } catch (error) {
            if ((error as { code?: string })?.code !== 'P2002') throw error;
            throw new ConflictException('Interview sudah dimulai.');
        }

        let providerId: string | undefined;
        try {
            const response = await this.provider.create(request, managed ?
                Math.max(1, Math.min(25_000, activeDeadlineAt - Date.now() - LIVE_CLOSE_RESERVE_MS)) : undefined);
            providerId = response.session?.id;
            if (managed && providerId) await this.journal?.recordProviderId(row.id, providerId)
                .catch(() => this.logger.warn('Tara Live provider ID journal unavailable'));
            if (!providerId || !response.transport?.sdp) throw Error('VOICE_CREATE_INVALID');
            const live: Live = { providerId, taraProgress, opening: request.session.input[1].content[0].text,
                acceptedAt: Date.now(), delivery: { sequence: 0, windows: [] }, fragments: [], queue: [],
                seen: new Set(), pending: Promise.resolve(), closed: false, finishing: false, sidebandLostAt: Date.now(),
                ...(managed ? { completion: { sessionId: id, connectionId: row.id,
                    usedVoiceMs: completion?.usedVoiceMs ?? 0, startedAt: reservedAt - (completion?.usedVoiceMs ?? 0), deadlineAt: activeDeadlineAt } } : {}) };
            this.active.set(row.id, live);
            if (live.completion?.deadlineAt !== undefined) this.hardStopAt(row.id, live, live.completion.deadlineAt, Date.now());
            row = await this.db.voiceInterview.update({ where: { id: row.id, ...(resume ? { resumedForId: id } : { sessionId: id }), owner: this.owner, status: 'CREATING' }, data: {
                providerId, status: 'ACTIVE', heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + recorderLeaseMs) } });
            if (live.closed || live.requestedClose) throw Error('VOICE_BUDGET_USED_DURING_STARTUP');
            this.attach(row.id, live);
            const state = managed ? await this.db.aiScreeningSession.findUniqueOrThrow({ where: { id },
                select: { voiceCompletion: true, voiceDeadlineAt: true, revision: true } }) : undefined;
            return { ...this.safe(row, state), sdp: response.transport.sdp };
        } catch (error) {
            if (!providerId && error instanceof VoiceCreationRejected) {
                await this.connectionRejected(row, id, managed ? completion ?? newLiveCompletion() : undefined);
                throw new ServiceUnavailableException('Koneksi suara belum tersedia. Silakan coba lagi sebentar.');
            }
            if (providerId) {
                await this.finish(row.id, 'CONNECTION_FAILED', { providerId, managed });
            } else await this.finalize(row.id, { status: 'CREATE_UNCERTAIN', endedAt: new Date(), closeReason: 'CONNECTION_UNCONFIRMED',
                error: 'Pembuatan koneksi belum terkonfirmasi. Hubungi HR untuk sesi baru.' });
            throw new ServiceUnavailableException('Koneksi interview belum berhasil. Hasil yang tersedia tetap tersimpan.');
        }
    }

    private async connectionRejected(row: VoiceInterview, id: string, previous?: LiveCompletion) {
        await this.db.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${id} FOR UPDATE`;
            const removed = await tx.voiceInterview.deleteMany({ where: { id: row.id, status: 'CREATING', providerId: null, owner: this.owner } });
            if (removed.count && previous)
                await tx.aiScreeningSession.updateMany({ where: { id, status: 'ACTIVE' }, data: {
                    voiceCompletion: json(previous), voiceDeadlineAt: null, leaseToken: null, leaseExpiresAt: null, revision: { increment: 1 },
                } });
        });
    }

    private attach(id: string, live: Live) {
        const lost = () => {
            live.channelReady = false;
            live.channel = undefined;
            if (!live.backupReady) live.sidebandLostAt ??= Date.now();
            live.reattachAfter = Date.now() + 250;
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
                if (live.sidebandLostAt !== undefined && Date.now() - live.sidebandLostAt > 3000 && live.delivery.readyAt !== undefined) {
                    live.captureFailed = true;
                    (live.captureGaps ??= []).push({ start: live.sidebandLostAt, end: Date.now(), reason: 'SIDEBAND_REPLAY_WINDOW' });
                }
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

    private attachBackup(id: string, live: Live) {
        if (live.backupChannel || !this.journal || Date.now() < (live.nextBackupAttachAt ?? 0)) return;
        live.nextBackupAttachAt = Date.now() + 5000;
        try {
            const channel = this.provider.attach(live.providerId, event => {
                if (live.backupChannel !== channel) return;
                if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta' ||
                    event.type === 'session.closed' || event.type === 'session.usage.updated') this.accept(id, event);
            }, () => {
                if (live.backupChannel !== channel) return;
                live.backupChannel = undefined;
                live.backupReady = false;
                if (!live.channelReady) live.sidebandLostAt ??= Date.now();
                channel.dispose();
            });
            live.backupChannel = channel;
            void channel.opened.then(() => {
                if (live.backupChannel === channel) live.backupReady = true;
            }).catch(() => {
                if (live.backupChannel !== channel) return;
                live.backupChannel = undefined;
                live.backupReady = false;
                if (!live.channelReady) live.sidebandLostAt ??= Date.now();
                channel.dispose();
            });
        } catch { /* The primary subscriber continues receiving provider events. */ }
    }

    private accept(id: string, event: Record<string, unknown>) {
        const live = this.active.get(id);
        if (!live) return;
        const transcript = event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta';
        if (live.closed && (!transcript || Date.now() >= (live.transcriptDrainUntil ?? 0))) return;
        switch (event.type) {
            case 'session.started':
                live.providerStartedAt ??= Date.now();
                return;
            case 'session.closed': {
                live.closed = true;
                live.usage = event.usage;
                // A second subscriber can still be delivering the final words.
                if ((live.channelReady && live.backupReady) || live.closingWithFallback)
                    live.transcriptDrainUntil = Date.now() + redundantTranscriptDrainMs;
                const deadline = live.completion?.deadlineAt;
                const timedOut = event.reason === 'expired' || (event.reason === 'close_requested' && deadline !== undefined && Date.now() >= deadline);
                const reason = timedOut ? 'TIME_LIMIT' : event.reason === 'connection_lost' ? 'CONNECTION_LOST' :
                    event.reason === 'remote_hangup' ? 'CANDIDATE_DISCONNECTED' : 'PROVIDER_ENDED';
                live.requestedClose ??= reason;
                if (!live.finishing) this.requestFinish(id, live.requestedClose);
                return;
            }
            case 'session.usage.updated': {
                const observed = reportedVoiceMs(event.usage);
                if (observed === undefined || observed <= (live.observedVoiceMs ?? -1)) return;
                live.observedVoiceMs = observed;
                if (live.completion?.deadlineAt !== undefined) {
                    const now = Date.now();
                    const estimatedDeadline = now + Math.max(0, VOICE_HARD_MS - live.completion.usedVoiceMs - observed);
                    if (estimatedDeadline < live.completion.deadlineAt) {
                        live.completion.deadlineAt = estimatedDeadline;
                        this.hardStopAt(id, live, estimatedDeadline, now);
                        void this.persistDeadline(live).catch(() => this.logger.warn('Tara Live could not persist the updated time limit'));
                    }
                }
                return;
            }
            case 'error':
                if (!live.finishing) this.logger.warn('Tara Live provider reported a control or media error');
                return;
            case 'session.delegation.created':
                if (!live.unexpectedDelegation) this.logger.warn('Tara Live attempted delegation without a backend model');
                live.unexpectedDelegation = true;
                return;
            case 'session.input_audio.append': {
                const now = Date.now();
                live.mediaObservedAt = now;
                // WebRTC input can arrive before the browser reports the new speech state.
                if (!live.exchangeStarted && !live.openingSent && reflectedVoiceSignal(event.audio))
                    live.lastInputAudioAt = now;
                return;
            }
            case 'session.output_audio.delta': {
                live.mediaObservedAt = Date.now();
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
                        this.verifyPlayback(live);
                    }
                    live.latestOutputEnd = Math.max(live.latestOutputEnd ?? 0, end);
                }
                return;
            }
            case 'session.input_transcript.delta':
            case 'session.output_transcript.delta': {
                const delta = transcriptDelta(event);
                if (!delta) {
                    if (typeof event.delta !== 'string' || !event.delta.trim()) return;
                    live.captureFailed = true;
                    const gaps = live.captureGaps ??= [];
                    if (!gaps.some(gap => gap.reason === 'INVALID_TRANSCRIPT_FRAGMENT'))
                        gaps.push({ start: Date.now(), reason: 'INVALID_TRANSCRIPT_FRAGMENT' });
                    return;
                }
                if (live.seen.has(delta.eventId)) return;
                live.mediaObservedAt = Date.now();
                if (delta.text.trim()) live.exchangeStarted = true;
                if (live.queue.length >= 1024 || live.seen.size >= 30_000) {
                    live.captureFailed = true;
                    const gaps = live.captureGaps ??= [];
                    if (!gaps.some(gap => gap.reason === 'TRANSCRIPT_BUFFER_FULL'))
                        gaps.push({ start: Date.now(), reason: 'TRANSCRIPT_BUFFER_FULL' });
                    return;
                }
                live.seen.add(delta.eventId);
                live.queue.push(delta);
                if (live.completion && this.journal) this.scheduleTranscriptFlush(id, live);
            }
        }
    }

    private async replayJournal(id: string, remove = true) {
        if (!this.journal) return { restored: [] as Fragment[], gap: false };
        const { rows, gap } = await this.journal.batches(id);
        if (!rows.length && !gap) return { restored: [] as Fragment[], gap };
        const restored = await this.storeTranscript(id, rows.flat());
        if (remove) await this.journal.remove(id);
        return { restored, gap };
    }

    private storeTranscript(id: string, rows: Captured[]) {
        return this.db.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "VoiceInterview" WHERE id=${id} FOR UPDATE`;
            const target = await tx.voiceInterview.findUnique({ where: { id }, select: { sessionId: true, resumedForId: true, closeReason: true } });
            if (!(target?.sessionId ?? target?.resumedForId) || target?.closeReason === 'ACCOUNT_ERASED') return [];
            const stored: Fragment[] = [];
            for (let start = 0; start < rows.length; start += 1024) {
                stored.push(...await tx.voiceFragment.createManyAndReturn({
                    data: rows.slice(start, start + 1024).map(fragment => ({ ...fragment, voiceId: id })), skipDuplicates: true,
                }));
            }
            return stored;
        });
    }

    private scheduleTranscriptFlush(id: string, live: Live) {
        if (live.finishing || live.flushTimer || live.flushing || !live.queue.length) return;
        live.flushTimer = setTimeout(() => {
            live.flushTimer = undefined;
            if (live.finishing || live.flushing) return;
            live.flushing = this.flush(id, live).finally(() => {
                live.flushing = undefined;
                this.scheduleTranscriptFlush(id, live);
            });
        }, 400);
        live.flushTimer.unref();
    }

    private async flush(id: string, live: Live) {
        if (!live.queue.length) return;
        const batch = live.queue.splice(0);
        live.writingTranscript = batch;
        // Keep the file until closure so this writer can run ahead of PostgreSQL.
        const journal = live.completion ? this.journal : undefined;
        const journaled = await journal?.append(id, batch).then(() => true, () => false);
        live.pending = live.pending.then(async () => {
            live.fragments.push(...await this.storeTranscript(id, batch));
        }).catch(() => {
            if (journaled) return;
            if (live.queue.length + batch.length <= 1024) live.queue.unshift(...batch);
            else {
                live.captureFailed = true;
                (live.captureGaps ??= []).push({ start: Date.now(), reason: 'TRANSCRIPT_BUFFER_FULL' });
            }
            this.logger.warn('Tara Live could not persist a transcript batch');
        });
        if (!journaled) await live.pending;
        live.writingTranscript = undefined;
    }

    private openConversation(live: Live, now: number) {
        const ready = live.delivery.playbackReadyAt;
        // A WebRTC join also establishes that the session is running. The
        // sideband can attach after the provider sent its startup event.
        const started = live.providerStartedAt !== undefined || Boolean(live.completion && live.delivery.readyAt !== undefined);
        if (!live.opening || live.closed || live.finishing || ready === undefined || now - ready < (live.completion ? managedOpeningGraceMs : openingGraceMs) ||
            !live.channelReady || !started || live.sidebandLostAt !== undefined || live.exchangeStarted ||
            live.openingSent || live.inputQuiet !== true ||
            now - (live.inputObservedAt ?? 0) > 5000 ||
            now - (live.lastInputAudioAt ?? 0) < openingInputQuietMs) return;
        try {
            live.channel?.requestOpening(live.opening);
            live.openingSent = true;
        } catch { this.logger.warn('Tara Live startup greeting could not be requested'); }
    }

    private startClock(id: string, live: Live, at: number, now: number) {
        if (live.delivery.clockStartedAt !== undefined) return false;
        live.delivery.clockStartedAt = at;
        if (live.completion) live.completion.deadlineAt ??= at + VOICE_HARD_MS;
        this.hardStopAt(id, live, live.completion?.deadlineAt ?? at + VOICE_HARD_MS, now);
        return true;
    }

    private hardStopAt(id: string, live: Live, deadline: number, now: number) {
        if (live.hardTimer) clearTimeout(live.hardTimer);
        live.hardTimer = setTimeout(() => this.requestFinish(id, 'TIME_LIMIT'),
            Math.max(0, deadline - now - (live.completion ? LIVE_CLOSE_RESERVE_MS : 0)));
        live.hardTimer.unref();
    }

    private verifyPlayback(live: Live) {
        const { firstAudible } = live.delivery;
        const reflectedAt = live.firstOutputReceivedAt;
        // The WebRTC observer and the sideband copy can arrive in either order.
        if (live.channelReady && !live.captureFailed && firstAudible !== undefined && reflectedAt !== undefined &&
            Math.abs(firstAudible - reflectedAt) <= 1500) live.delivery.playbackVerified = true;
    }

    private async persistDeadline(live: Live) {
        if (live.completion?.deadlineAt === undefined) return;
        const deadline = new Date(live.completion.deadlineAt);
        await this.db.aiScreeningSession.updateMany({ where: {
            id: live.completion.sessionId, status: 'ACTIVE',
            voiceCompletion: { path: ['activeConnectionId'], equals: live.completion.connectionId },
            OR: [{ voiceDeadlineAt: null }, { voiceDeadlineAt: { gt: deadline } }],
        }, data: { voiceDeadlineAt: deadline } });
    }

    private assertConnection(row: VoiceInterview, session: VoiceSessionState, connectionId?: string) {
        if (liveCompletion(session.voiceCompletion) && row.id !== connectionId)
            throw new ConflictException('Muat ulang untuk menyambung ke koneksi interview aktif.');
    }

    async media(user: AuthUser, id: string, clientId: string, event: MediaSignal, sequence: number, delayMs: number, connectionId?: string) {
        const session = await this.owned(user, id);
        const row = await this.connection(id, session);
        if (!row) throw new NotFoundException('Sesi suara tidak tersedia.');
        this.assertConnection(row, session, connectionId);
        if (terminal.includes(row.status)) return this.safe(row, session);
        if (session.leaseToken !== clientId || !session.leaseExpiresAt || +session.leaseExpiresAt <= Date.now())
            throw new ConflictException('Tab interview tidak aktif.');
        const live = this.active.get(row.id);
        if (!live || live.finishing || live.closed || row.owner !== this.owner) throw new ConflictException('Koneksi Tara tidak aktif.');
        const now = Date.now();
        if (delayMs >= 2500 && event !== 'READY') {
            if (event === 'INPUT_ACTIVE' || event === 'INPUT_QUIET') live.inputQuiet = undefined;
            return this.safe(row, session);
        }
        const at = Math.max(+row.createdAt, now - delayMs);
        if (!recordMedia(live.delivery, event, sequence, at)) return this.safe(row, session);
        if (event === 'MEDIA_LOST') { live.disconnectedAt ??= at; return this.safe(row, session); }
        if (event === 'MEDIA_RESTORED') { live.disconnectedAt = undefined; live.mediaObservedAt = now; return this.safe(row, session); }
        if (event === 'PLAYER_BLOCKED') { live.delivery.playbackReadyAt = undefined; live.playbackBlockedAt ??= now; return this.safe(row, session); }
        if (event === 'PLAYBACK_READY' || event === 'AUDIBLE') live.playbackBlockedAt = undefined;
        if (event === 'INPUT_ACTIVE' || event === 'INPUT_QUIET') {
            const wasSpeaking = live.inputQuiet === false;
            live.inputObservedAt = at;
            live.inputQuiet = event === 'INPUT_QUIET';
            if (!live.inputQuiet || wasSpeaking)
                live.candidateLastSpeechAt = Math.max(live.candidateLastSpeechAt ?? 0, at);
            if (!live.inputQuiet) live.exchangeStarted = true;
            else if (live.completion) this.openConversation(live, now);
            return this.safe(row, session);
        }
        if (event === 'PLAYBACK_READY' && live.completion && !live.openingTimer) {
            live.openingTimer = setTimeout(() => this.openConversation(live, Date.now()), managedOpeningGraceMs);
            live.openingTimer.unref();
        }
        let clockStarted = false;
        if (event === 'AUDIBLE') {
            live.disconnectedAt = undefined;
            live.mediaObservedAt = now;
            live.exchangeStarted = true;
            this.verifyPlayback(live);
            clockStarted = this.startClock(row.id, live, at, now);
        }
        if (event === 'AUDIBLE' || event === 'QUIET' || event === 'INTERRUPTED') live.playbackObservedAt = now;
        const delivery = json(this.progress(live));
        const written = live.pending.then(async () => {
            if (clockStarted) await this.persistDeadline(live);
            await this.db.voiceInterview.updateMany({ where: { id: row.id, OR: [{ sessionId: id }, { resumedForId: id }],
                status: { in: ['ACTIVE', 'CLOSING'] }, owner: this.owner,
                AND: [{ OR: [{ closeReason: null }, { closeReason: { not: 'ACCOUNT_ERASED' } }] }] },
                data: { taraInterview: delivery, ...(clockStarted ? { startedAt: new Date(at) } : {}) } });
        });
        // A failed checkpoint leaves the playback evidence in memory for the
        // next checkpoint or finalization. Transcript capture has its own path.
        live.pending = written.catch(() => this.logger.warn('Tara Live could not checkpoint playback metadata'));
        return this.safe(row, session);
    }

    async heartbeat(user: AuthUser, id: string, clientId: string, connected = false, connectionId?: string) {
        const session = await this.owned(user, id);
        const voice = await this.connection(id, session);
        if (voice) this.assertConnection(voice, session, connectionId);
        if (voice && terminal.includes(voice.status)) return this.safe(voice, session);
        const renewed = await this.db.aiScreeningSession.updateMany({ where: { id, leaseToken: clientId, status: 'ACTIVE',
            ...(voice && liveCompletion(session.voiceCompletion) ? { voiceCompletion: { path: ['activeConnectionId'], equals: voice.id } } : {}) },
            data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        if (!renewed.count) throw new ConflictException('Interview digunakan tab lain.');
        const now = new Date();
        if (voice) await this.db.voiceInterview.updateMany({ where: { id: voice.id, status: { in: ['CONNECTING', 'ACTIVE', 'CLOSING'] } }, data: {
            heartbeatAt: now,
            ...(voice.reservedVoiceMs === null ? {} : { mediaConnectedAt: connected ? now : null }),
        } });
        const live = voice && this.active.get(voice.id);
        if (live && connected) { live.delivery.readyAt ??= +now; live.disconnectedAt = undefined; }
        if (live && !connected && live.delivery.readyAt !== undefined) live.disconnectedAt ??= +now;
        return voice ? this.safe(voice, session) : null;
    }

    async end(user: AuthUser, id: string, clientId: string, reason = 'CANDIDATE_ENDED', connectionId?: string) {
        const session = await this.owned(user, id);
        const row = await this.connection(id, session);
        if (row) this.assertConnection(row, session, connectionId);
        if (row && terminal.includes(row.status)) return this.state(user, id);
        if (session.leaseToken !== clientId || liveCompletion(session.voiceCompletion) && (!session.leaseExpiresAt || +session.leaseExpiresAt <= Date.now()))
            throw new ConflictException('Interview digunakan tab lain.');
        if (reason === 'CANDIDATE_PAUSED' && !liveCompletion(session.voiceCompletion))
            throw new ConflictException('Jeda tersedia untuk undangan wawancara yang mendukung kelanjutan.');
        if (row) await this.finish(row.id, reason);
        return this.state(user, id);
    }

    async tick(now = new Date()) {
        if (this.ticking) return;
        this.ticking = true;
        try {
            const rows = await this.db.voiceInterview.findMany({ where: { status: { notIn: terminal } } });
            await Promise.allSettled(rows.map(row => this.watch(row, now)));
            const stranded = await this.db.voiceInterview.findMany({ where: { status: { in: terminal }, OR: [
                { session: { status: 'ACTIVE', voiceCompletion: { equals: Prisma.DbNull } } },
                { session: { status: 'ACTIVE', voiceCompletion: { path: ['status'], equals: 'IN_PROGRESS' } } },
                { resumedFor: { status: 'ACTIVE', voiceCompletion: { path: ['status'], equals: 'IN_PROGRESS' } } },
            ] }, take: 25 });
            for (const row of stranded) await this.finalize(row.id);
            await expireLiveContinuations(this.db, now);
            if (+now >= this.nextEvaluationCheck) {
                this.nextEvaluationCheck = +now + 30_000;
                await reconcileLiveEvaluations(this.db, now);
                if (this.journal) {
                    for (const id of await this.journal.ids()) {
                        if (this.active.has(id)) continue;
                        const row = await this.db.voiceInterview.findUnique({ where: { id }, select: { status: true, closeReason: true, sessionId: true, resumedForId: true } });
                        if (!row || !(row.sessionId ?? row.resumedForId) || row.closeReason === 'ACCOUNT_ERASED' || terminal.includes(row.status)) {
                            await this.journal.remove(id);
                            await this.journal.remove(id, '.closed');
                            await this.journal.remove(id, '.provider');
                        }
                    }
                }
            }
        } finally { this.ticking = false; }
    }

    private async recoverRecorder(row: VoiceInterview, now: Date, lastOwnerTick: number) {
        const sessionId = row.sessionId ?? row.resumedForId;
        if (!sessionId || row.status !== 'ACTIVE' || !row.providerId || row.reservedVoiceMs === null ||
            row.closeReason || row.closingAt || row.billedVoiceMs !== null || row.error || !row.mediaConnectedAt) return false;
        const saved = row.taraInterview as NativeProgress | null;
        if (!saved?.topics) return false;
        const session = await this.db.aiScreeningSession.findFirst({ where: { id: sessionId, status: 'ACTIVE', invitation: { status: 'STARTED' } },
            select: { voiceCompletion: true, voiceDeadlineAt: true } });
        const completion = liveCompletion(session?.voiceCompletion);
        if (completion?.status !== 'IN_PROGRESS' || completion.activeConnectionId !== row.id || !session?.voiceDeadlineAt) return false;
        const deadlineAt = +session.voiceDeadlineAt;
        if (+now >= deadlineAt - LIVE_CLOSE_RESERVE_MS) {
            await this.finish(row.id, 'TIME_LIMIT');
            return true;
        }
        if (await this.journal?.readClosure(row.id)) return false;
        // Restore evidence while leaving the journal available to both recorders until closure.
        const replay = await this.replayJournal(row.id, false);
        const fragments = await this.db.voiceFragment.findMany({ where: { voiceId: row.id }, orderBy: { id: 'asc' } });
        const { nativeDelivery, captureGaps, ...taraProgress } = saved;
        const usedVoiceMs = completion.usedVoiceMs ?? 0;
        const heartbeatStale = +now - +row.mediaConnectedAt >= mediaHeartbeatFreshMs;
        const live: Live = {
            providerId: row.providerId, taraProgress, delivery: { sequence: 0, windows: [], ...nativeDelivery,
                readyAt: nativeDelivery?.readyAt ?? +row.mediaConnectedAt }, fragments, queue: [],
            seen: new Set(fragments.map(fragment => fragment.eventId)), pending: Promise.resolve(), closed: false, finishing: false,
            acceptedAt: +row.createdAt, exchangeStarted: true, observedVoiceMs: row.observedVoiceMs ?? undefined,
            // The API may recover just before the next heartbeat. Give the existing peer its normal recovery window.
            disconnectedAt: heartbeatStale ? +now : undefined,
            sidebandLostAt: Math.max(+row.createdAt, lastOwnerTick), captureGaps,
            captureFailed: Boolean(captureGaps?.length || replay.gap),
            completion: { sessionId, connectionId: row.id, deadlineAt, usedVoiceMs, startedAt: +row.createdAt - usedVoiceMs },
        };
        this.active.set(row.id, live);
        this.hardStopAt(row.id, live, deadlineAt, Math.max(+now, Date.now()));
        this.attach(row.id, live);
        return true;
    }

    private async watch(row: VoiceInterview, now: Date) {
        if (!(row.sessionId ?? row.resumedForId)) { await this.finish(row.id, 'ACCOUNT_ERASED'); return; }
        const live = this.active.get(row.id);
        if (row.owner !== this.owner) {
            if (live && !live.finishing) await this.releaseRecorder(row.id, live);
            if (row.leaseUntil <= now) {
                const [claimed] = await this.db.voiceInterview.updateManyAndReturn({
                    where: { id: row.id, owner: row.owner, status: row.status, leaseUntil: { lte: now } },
                    data: { owner: this.owner, leaseUntil: new Date(+now + recorderLeaseMs) },
                });
                if (claimed && !await this.recoverRecorder(claimed, now, +row.leaseUntil - recorderLeaseMs))
                    await this.finish(row.id, 'SERVER_RESTART');
            }
            return;
        }
        const observed = live?.completion ? live.observedVoiceMs : undefined;
        const saveObserved = row.status === 'ACTIVE' && observed !== undefined && observed > (row.observedVoiceMs ?? -1);
        const stillOwned = await this.db.voiceInterview.updateMany({ where: { id: row.id, owner: this.owner, status: row.status }, data: {
            leaseUntil: new Date(+now + recorderLeaseMs), ...(saveObserved ? { observedVoiceMs: observed } : {}),
        } });
        if (!stillOwned.count) return;
        const startupDeadline = +row.createdAt + NATIVE_STARTUP_MS;
        if (row.status === 'CLOSING') { await this.finish(row.id, row.closeReason ?? 'CONNECTION_LOST'); return; }
        if (live?.closed) { await this.finish(row.id, live.requestedClose ?? 'PROVIDER_ENDED'); return; }
        if (+now >= startupDeadline && !live && !row.providerId) {
            const managed = Boolean(row.reservedVoiceMs !== null ||
                (row.promptSnapshot as { completion?: boolean } | null)?.completion);
            await this.finish(row.id, managed && row.status === 'CREATING' ? 'CONNECTION_UNCONFIRMED' : 'CONNECTION_FAILED');
            return;
        }
        if (!live && row.providerId) {
            if (!await this.recoverRecorder(row, now, +row.createdAt) && +now >= startupDeadline)
                await this.finish(row.id, 'SERVER_RESTART');
            return;
        }
        if (!live || live.closed || live.finishing) return;
        const connectedAt = row.mediaConnectedAt && +row.mediaConnectedAt;
        if (live.completion && connectedAt && +now - connectedAt < mediaHeartbeatFreshMs && connectedAt > (live.disconnectedAt ?? 0)) {
            live.delivery.readyAt ??= connectedAt;
            live.disconnectedAt = undefined;
        }
        if (live.completion && live.delivery.readyAt !== undefined && live.disconnectedAt !== undefined &&
            live.disconnectedAt < +now - 12_000 && (live.mediaObservedAt ?? 0) < +now - 4000) {
            await this.finish(row.id, 'CONNECTION_LOST');
            return;
        }
        if (!live.channel && +now >= (live.reattachAfter ?? 0)) this.attach(row.id, live);
        if (live.completion && this.config.get('TARA_TRANSCRIPT_REDUNDANT') === 'true') this.attachBackup(row.id, live);
        // A slow transcript write must not hold the lifecycle or the media connection.
        if (!live.flushing && !live.flushTimer && live.queue.length)
            live.flushing = this.flush(row.id, live).finally(() => { live.flushing = undefined; });

        // Missing diagnostics do not establish that WebRTC has disconnected.
        const ready = live.completion
            ? (live.delivery.playbackReadyAt !== undefined ? live.firstOutputReceivedAt : undefined)
            : live.delivery.readyAt ?? live.providerStartedAt ??
                (live.exchangeStarted || +now >= live.acceptedAt + NATIVE_STARTUP_MS ? live.acceptedAt : undefined);
        this.openConversation(live, +now);
        if (live.completion && live.delivery.clockStartedAt === undefined && ready === undefined &&
            +now >= live.acceptedAt + NATIVE_STARTUP_MS &&
            (live.playbackBlockedAt !== undefined || live.delivery.readyAt === undefined && (live.mediaObservedAt ?? 0) < +now - 15_000)) {
            await this.finish(row.id, 'AUDIO_UNAVAILABLE');
            return;
        }
        if (ready !== undefined && +now >= ready + clockFallbackMs && this.startClock(row.id, live, ready, +now)) {
            await this.persistDeadline(live);
            await this.db.voiceInterview.updateMany({ where: { id: row.id, status: 'ACTIVE', owner: this.owner },
                data: { startedAt: new Date(ready) } });
        }
        const started = live.completion?.startedAt ?? live.delivery.clockStartedAt;
        if (started === undefined) return;
        const clock = voiceClock(new Date(started), now);
        if (clock.hard || live.completion?.deadlineAt !== undefined && +now >= live.completion.deadlineAt - LIVE_CLOSE_RESERVE_MS) {
            await this.finish(row.id, 'TIME_LIMIT'); return;
        }
        if (clock.warning && !row.warningAt)
            await this.db.voiceInterview.updateMany({ where: { id: row.id, warningAt: null }, data: { warningAt: now } });
        if (live.completion && clock.elapsed < LIVE_DEEPEN_MS) return;
        if (live.captureFailed || !live.channelReady || live.queue.length || live.flushing || live.inputQuiet !== true ||
            +now - (live.inputObservedAt ?? 0) > 5000) return;
        const played = live.delivery.windows.at(-1);
        if (!played || played.interrupted || live.delivery.open !== undefined ||
            played.end === live.checkedPlaybackEnd && live.fragments.length === live.checkedFragmentCount ||
            +now - (live.playbackObservedAt ?? played.end) < farewellGraceMs) return;
        if (live.latestOutputEnd !== undefined && live.delivery.firstAudible !== undefined && live.delivery.firstAudioMs !== undefined &&
            live.delivery.firstAudible - live.delivery.firstAudioMs + live.latestOutputEnd > played.end + 350) return;
        // The reservation includes startup. Compare the spoken farewell with
        // the provider timeline and confirmed time from earlier connections.
        const earliestFarewell = live.completion ? Math.max(0, LIVE_DEEPEN_MS - live.completion.usedVoiceMs) : 0;
        const farewell = directFarewellAt(live.fragments, live.delivery, earliestFarewell, live.candidateLastSpeechAt);
        if (farewell !== undefined) {
            await this.finish(row.id, 'TARA_FINISHED');
        } else {
            live.checkedPlaybackEnd = played.end;
            live.checkedFragmentCount = live.fragments.length;
        }
    }

    private progress(live: Live): NativeProgress {
        return { ...live.taraProgress, nativeDelivery: live.delivery, captureGaps: live.captureGaps };
    }

    private requestFinish(id: string, reason: string) {
        void this.finish(id, reason).catch(() => this.logger.warn('Voice closure will retry.'));
    }

    private closeVoice(id: string, live: Live, reason: string) {
        live.requestedClose ??= reason;
        if (live.closed) return Promise.resolve({ usage: live.usage });
        if (live.closingReceipt) return Promise.resolve(live.closingReceipt);
        return live.providerClose ??= (async () => {
            if (live.channelReady && live.channel) {
                try { live.channel.closeSession(); } catch { live.channelReady = false; }
                const until = Date.now() + 2500;
                while (!live.closed && live.channelReady && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
                if (live.closed) return { usage: live.usage };
            }
            live.closingWithFallback = true;
            const fallback = await this.provider.closeWebRtc(live.providerId, event => this.accept(id, event)).catch(() => undefined);
            live.closingWithFallback = false;
            // The original subscriber can receive the terminal event while the fallback is still waiting.
            const receipt = fallback ?? (live.closed ? { usage: live.usage } : undefined);
            if (receipt) live.closingReceipt = receipt;
            return receipt;
        })().catch(() => undefined).finally(() => { live.providerClose = undefined; });
    }

    private async drainTranscript(id: string, live: Live) {
        const waitMs = (live.transcriptDrainUntil ?? 0) - Date.now();
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
        await live.flushing;
        await this.flush(id, live);
        if (live.queue.length) await this.flush(id, live);
    }

    private detachRecorder(id: string, live: Live) {
        if (live.hardTimer) clearTimeout(live.hardTimer);
        if (live.flushTimer) clearTimeout(live.flushTimer);
        if (live.openingTimer) clearTimeout(live.openingTimer);
        this.active.delete(id);
        live.channel?.dispose();
        live.backupChannel?.dispose();
    }

    private async releaseRecorder(id: string, live: Live) {
        live.finishing = true;
        this.detachRecorder(id, live);
        await this.drainTranscript(id, live);
    }

    async finish(id: string, reason: string, startup?: { providerId: string; managed: boolean }) {
        const live = this.active.get(id);
        if (live?.finishing) return;
        if (live) {
            live.finishing = true;
            live.requestedClose ??= reason;
        }
        // Start shutting down media before database I/O, even if a
        // transcript batch or the entire database is temporarily stalled.
        const recovered: Captured[] = [];
        const recoverTranscript = (event: Record<string, unknown>) => {
            const delta = transcriptDelta(event);
            if (delta && recovered.length < 1024) recovered.push(delta);
        };
        const activeClose = live ? this.closeVoice(id, live, reason) : startup ?
            this.provider.closeWebRtc(startup.providerId, recoverTranscript).catch(() => undefined) : undefined;
        const providerClose = activeClose?.then(async receipt => {
            if (startup?.managed && recovered.length && this.journal && reason !== 'ACCOUNT_ERASED') {
                // An incomplete join can still deliver transcript events at closure.
                await this.journal.append(id, recovered).then(() => { recovered.length = 0; })
                    .catch(() => this.logger.warn('Tara Live startup transcript journal unavailable'));
            }
            const billedVoiceMs = reportedVoiceMs(receipt?.usage);
            if ((live?.completion || startup?.managed) && reason !== 'ACCOUNT_ERASED' && billedVoiceMs !== undefined) {
                const playback = live ? { nativeDelivery: live.delivery, captureGaps: live.captureGaps } : undefined;
                // A restart can happen after usage is acknowledged but before the last transcript batch is durable.
                const transcriptTail = live ? [...(live.writingTranscript ?? []), ...live.queue] : [];
                await this.journal?.recordClosure(id, { billedVoiceMs, closeReason: live?.requestedClose ?? reason, playback,
                    ...(transcriptTail.length ? { transcriptTail } : {}) })
                    .catch(() => this.logger.warn('Tara Live closure journal unavailable'));
            }
            return receipt;
        });
        try {
            const row = await this.db.voiceInterview.findUnique({ where: { id } });
            if (!row || terminal.includes(row.status)) {
                await providerClose;
                return;
            }
            const managed = Boolean(live?.completion || row.reservedVoiceMs !== null ||
                (row.promptSnapshot as { completion?: boolean } | null)?.completion);
            const receiptJournal = managed ? this.journal : undefined;
            const settled = !live ? await receiptJournal?.readClosure(id).catch(() => undefined) : undefined;
            const requested = live?.requestedClose ?? reason;
            const closeReason = row.closeReason === 'ACCOUNT_ERASED' || requested === 'ACCOUNT_ERASED' ? 'ACCOUNT_ERASED' :
                row.closeReason ?? settled?.closeReason ?? requested;
            // The provider can allocate a connection and return its ID without
            // a usable SDP. Save the handle so a restart can still close it.
            const providerId = row.providerId ?? live?.providerId ?? startup?.providerId ??
                await receiptJournal?.readProviderId(id).catch(() => undefined);
            await this.db.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } },
                data: { status: 'CLOSING', closeReason, closingAt: row.closingAt ?? new Date(),
                    ...(!row.providerId && providerId ? { providerId } : {}) } });
            const receipt = await providerClose;
            const saved = settled ?? (providerClose && row.billedVoiceMs === null ? await receiptJournal?.readClosure(id).catch(() => undefined) : undefined);
            const savedUsageMs = row.billedVoiceMs ?? saved?.billedVoiceMs;
            let recoveredUsage: unknown;
            let recoveredClose = savedUsageMs !== undefined || Boolean(receipt);
            if (providerId && !providerClose && !recoveredClose) {
                const confirmation = await this.provider.closeWebRtc(providerId, recoverTranscript);
                recoveredUsage = confirmation?.usage;
                recoveredClose = confirmation !== undefined;
            }
            const usage = receipt?.usage ?? live?.usage ?? recoveredUsage ?? row.usage ??
                (savedUsageMs === undefined ? undefined : { seconds: savedUsageMs / 1000 });
            const billedVoiceMs = savedUsageMs ?? reportedVoiceMs(usage);
            const uncommittedReceipt = billedVoiceMs !== undefined && row.billedVoiceMs === null;
            if (recovered.length && closeReason !== 'ACCOUNT_ERASED') {
                if (receiptJournal) await receiptJournal.append(id, recovered);
                else await this.storeTranscript(id, recovered);
            }
            // Keep the terminal receipt across a database outage or process restart.
            if (!providerClose && uncommittedReceipt && savedUsageMs === undefined && closeReason !== 'ACCOUNT_ERASED')
                await receiptJournal?.recordClosure(id, { billedVoiceMs, closeReason }).catch(() => this.logger.warn('Tara Live closure journal unavailable'));
            if (uncommittedReceipt) {
                await this.db.voiceInterview.updateMany({
                    where: { id, status: 'CLOSING', billedVoiceMs: null },
                    data: { usage: json(usage), billedVoiceMs },
                });
            }
            if (managed && live?.observedVoiceMs !== undefined && live.observedVoiceMs > (row.observedVoiceMs ?? -1)) {
                // Running usage aids reconciliation. Only a terminal receipt settles the reservation.
                await this.db.voiceInterview.updateMany({
                    where: { id, status: 'CLOSING', OR: [{ observedVoiceMs: null }, { observedVoiceMs: { lt: live.observedVoiceMs } }] },
                    data: { observedVoiceMs: live.observedVoiceMs },
                });
            }
            if (providerId && !recoveredClose && !live?.closed &&
                closeReason !== 'ACCOUNT_ERASED' && +(row.closingAt ?? new Date()) + 30_000 > Date.now())
                throw new Error('VOICE_CLOSE_UNCONFIRMED');
            const completeClose = recoveredClose || live?.closed === true;
            const finalReason = !completeClose && closeReason !== 'ACCOUNT_ERASED' ? 'CONNECTION_UNCONFIRMED' : closeReason;
            if (live && closeReason !== 'ACCOUNT_ERASED') {
                await this.drainTranscript(id, live);
                await live.pending;
            }
            if (managed) {
                const replay = await this.replayJournal(id);
                if (live) {
                    live.fragments.push(...replay.restored);
                    if (replay.gap) live.captureFailed = true;
                } else if (saved?.transcriptTail?.length && closeReason !== 'ACCOUNT_ERASED') {
                    await this.storeTranscript(id, saved.transcriptTail);
                }
            }
            const start = live?.delivery.clockStartedAt;
            const deadline = live?.completion?.deadlineAt ?? (start === undefined ? undefined : start + VOICE_HARD_MS);
            const endedAt = new Date(deadline === undefined ? Date.now() : Math.min(Date.now(), deadline));
            const complete = Boolean(live && completeClose && !live.queue.length && live.sidebandLostAt === undefined && !live.captureFailed &&
                (!technical(finalReason) || managed && live.inputQuiet === true));
            const playbackProgress = live ? this.progress(live) : saved?.playback &&
                { ...row.taraInterview as NativeProgress | null, ...saved.playback };
            const progress = (row.sessionId ?? row.resumedForId) && closeReason !== 'ACCOUNT_ERASED' && playbackProgress
                ? { ...playbackProgress, stage: 'DONE',
                    endedReason: !complete ? 'INTERRUPTED' : closeReason === 'TIME_LIMIT' ? 'TIME_LIMIT' : 'COMPLETE' }
                : undefined;
            if (closeReason === 'ACCOUNT_ERASED') await this.journal?.remove(id).catch(() => undefined);
            if (live) await this.persistDeadline(live);
            await this.finalize(id, { status: 'ENDED', endedAt, closeReason: finalReason, transcriptComplete: complete,
                ...(usage && !managed ? { usage: json(usage), billedVoiceMs } : {}),
                error: technical(finalReason) && finalReason !== 'ACCOUNT_ERASED'
                    ? 'Sesi suara terputus. Jawaban yang tersimpan tetap tersedia.' : null,
                ...(progress ? { taraInterview: json(progress) } : {}) });
            // Keep startup and playback recovery records until the terminal transaction commits.
            await receiptJournal?.remove(id, '.closed').catch(() => undefined);
            await receiptJournal?.remove(id, '.provider').catch(() => undefined);
        } catch {
            await providerClose;
            // Keep the final answer before handing this connection to another worker.
            if (live && live.requestedClose !== 'ACCOUNT_ERASED') await this.drainTranscript(id, live);
            await this.db.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } },
                data: { error: 'Penutupan koneksi sedang dicoba ulang.', leaseUntil: new Date(0),
                    ...(startup ? { providerId: startup.providerId } : {}) } });
        } finally {
            if (live) live.finishing = false;
            const retained = await this.db.voiceInterview.findUnique({ where: { id }, select: { status: true } });
            if (live && (!retained || terminal.includes(retained.status))) this.detachRecorder(id, live);
        }
    }

    private async finalize(id: string, change?: Prisma.VoiceInterviewUpdateManyMutationInput) {
        await this.db.$transaction(async tx => {
            const snapshot = await tx.voiceInterview.findUnique({ where: { id }, select: { sessionId: true, resumedForId: true } });
            const sessionId = snapshot?.sessionId ?? snapshot?.resumedForId;
            const session = sessionId ? await tx.aiScreeningSession.findUnique({ where: { id: sessionId }, include: { invitation: true } }) : null;
            if (session?.invitation) await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${session.invitation.id} FOR UPDATE`;
            if (sessionId) await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${sessionId} FOR UPDATE`;
            const retained = sessionId && await tx.aiScreeningSession.findUnique({ where: { id: sessionId },
                include: { invitation: true } });
            if (change) {
                const { taraInterview, ...lifecycle } = change;
                const committed = await tx.voiceInterview.updateMany({ where: { id, status: { notIn: terminal } }, data: lifecycle });
                if (committed.count && taraInterview) await tx.voiceInterview.updateMany({
                    where: { id, OR: [{ sessionId: { not: null } }, { resumedForId: { not: null } }], closeReason: { not: 'ACCOUNT_ERASED' } },
                    data: { taraInterview },
                });
            }
            if (!retained || !retained.invitation || retained.invitation.status === 'CANCELLED') return;
            const current = await tx.voiceInterview.findUnique({ where: { id }, select: { sessionId: true, resumedForId: true,
                endedAt: true, promptVersion: true, closeReason: true, billedVoiceMs: true, reservedVoiceMs: true } });
            if (!current || (current.sessionId ?? current.resumedForId) !== retained.id) return;
            const completion = liveCompletion(retained.voiceCompletion);
            if (completion) {
                if (completion.status !== 'IN_PROGRESS' || completion.activeConnectionId && completion.activeConnectionId !== id ||
                    retained.status !== 'ACTIVE' || retained.invitation.status !== 'STARTED') return;
                const confirmed = current.billedVoiceMs !== null;
                const billedMs = current.billedVoiceMs ?? current.reservedVoiceMs ?? VOICE_HARD_MS;
                const budget = voiceBudgetAfterClose(completion.usedVoiceMs ?? 0, billedMs);
                const endedAt = current.endedAt ?? new Date();
                const candidatePaused = current.closeReason === 'CANDIDATE_PAUSED';
                const canPause = candidatePaused || technical(current.closeReason ?? '');
                const pause = confirmed && canPause &&
                    budget.remainingVoiceMs >= LIVE_RESUME_MINIMUM_MS &&
                    (!completion.resumeExpiresAt || Date.parse(completion.resumeExpiresAt) > +endedAt);
                const next: LiveCompletion = { ...completion, ...budget, activeConnectionId: undefined,
                    status: pause ? 'RESUMABLE' : 'ASSESSING', evaluationRepair: undefined,
                    closedBy: current.closeReason === 'TIME_LIMIT' || current.closeReason === 'TARA_FINISHED' || current.closeReason === 'CANDIDATE_ENDED'
                        ? current.closeReason : undefined,
                    ...(canPause ? { resumeExpiresAt: completion.resumeExpiresAt ??
                        new Date(+endedAt + LIVE_RESUME_WINDOW_MS).toISOString() } : {}),
                    evidenceRevision: completion.evidenceRevision + 1,
                    reason: !confirmed ? 'CONNECTION_UNCONFIRMED' : candidatePaused ? 'CANDIDATE_PAUSED' : pause ? 'CONNECTION_LOST' : undefined };
                await tx.aiScreeningSession.update({ where: { id: retained.id }, data: {
                    voiceCompletion: json(next), voiceDeadlineAt: null, leaseToken: null, leaseExpiresAt: null, revision: { increment: 1 },
                } });
                await tx.aiScreeningEvaluation.upsert({ where: { sessionId: retained.id },
                    create: { sessionId: retained.id, status: 'PENDING', promptVersion: current.promptVersion }, update: { status: 'PENDING' } });
                if (!pause) await enqueueWork(tx, LIVE_EVALUATION_WORK, retained.id, liveEvaluationKey(retained.id, next.evidenceRevision));
                return;
            }
            await tx.aiScreeningSession.updateMany({ where: { id: retained.id, status: { not: 'COMPLETED' } },
                data: { status: 'COMPLETED', completedAt: current.endedAt ?? new Date(), leaseToken: null, leaseExpiresAt: null } });
            await tx.screeningInvitation.updateMany({ where: { id: retained.invitation.id, status: { not: 'CANCELLED' } }, data: { status: 'COMPLETED' } });
            await tx.aiScreeningEvaluation.upsert({ where: { sessionId: retained.id },
                create: { sessionId: retained.id, status: 'PENDING', promptVersion: current.promptVersion }, update: {} });
            await enqueueWork(tx, 'VOICE_EVALUATE', retained.id);
        });
    }

    async evaluate(workId: string, sessionId: string, owner?: string, reassessmentKey?: string, workKey?: string) {
        const voice = await this.db.voiceInterview.findUnique({ where: { sessionId }, include: takaVoiceInput });
        if (!voice?.session?.invitation || voice.session.invitation.status === 'CANCELLED') return;
        const completion = liveCompletion(voice.session.voiceCompletion);
        if (completion && (workKey && workKey !== liveEvaluationKey(sessionId, completion.evidenceRevision, completion.evaluationRepair) ||
            !['ASSESSING', 'REVIEW_REQUIRED'].includes(completion.status))) return;
        if (!terminal.includes(voice.status)) throw new AiPending('TAKA_VOICE_STILL_OPEN');
        if (!voice.session.currentPlan || !voice.session.package) throw new Error('TAKA_VOICE_SNAPSHOT_MISSING');
        const reassessment = reassessmentKey ? takaReassessment(voice) : null;
        if (reassessmentKey ? reassessment?.key !== reassessmentKey : !completion && voice.session.evaluation?.result) return;
        const plan = voice.session.currentPlan.payload as unknown as CandidatePayload;
        const rubric = voice.session.package.payload as unknown as PackagePayload;
        const progress = voice.taraInterview as unknown as NativeProgress | null;
        const direct = voice.promptVersion === TARA_LIVE_AUDIO_PROTOCOL;
        const topics = taraTopics(plan, rubric, Boolean(progress?.policyVersion));
        const resumed = completion ? await this.db.voiceInterview.findMany({ where: { resumedForId: sessionId },
            include: { fragments: { orderBy: { id: 'asc' } } }, orderBy: { connectionNumber: 'asc' } }) : [];
        if (resumed.some(row => !terminal.includes(row.status))) throw new AiPending('TAKA_VOICE_STILL_OPEN');
        const last = resumed.at(-1) ?? voice;
        const interrupted = technical(last.closeReason ?? '') || !last.transcriptComplete || last.closeReason === 'CANDIDATE_PAUSED';
        const delivery = progress?.nativeDelivery ?? { sequence: 0, windows: [] };
        const roleRubric = direct || voice.promptVersion === ROLE_VOICE_VERSION ? alignedRoleFromPacket(voice.session.package.jobSnapshot, rubric) : undefined;
        const evidenceV2 = Boolean(direct && roleRubric && (reassessment || !await this.db.aiScreeningCall.count({
            where: { workId, promptVersion: ROLE_ASSESSMENT_VERSION, status: { not: 'RECOVERED' } },
        })));
        const role = roleRubric ? { rubric: direct ? liveAgendaRubric(roleRubric, rubric.liveAgenda) : roleRubric, transcript: completion ?
            liveAssessmentTranscript([voice, ...resumed]) : roleLiveTranscript(
            evidenceV2 ? roleAssessmentVoiceEvidence(voice.fragments, delivery) : roleVoiceEvidence(voice.fragments, delivery, progress?.roleControl, direct).evidence,
            interrupted, direct), ...(evidenceV2 ? { evidenceV2 } : {}), ...(direct ? { direct } : {}) } : undefined;
        const topicOrder = (voice.promptSnapshot as { topicOrder?: string[] } | null)?.topicOrder;
        let legacyTopics = direct ? topics.slice(0, 4) : topics;
        if (direct && !role && topicOrder) {
            const planned = new Map(liveInterviewTopics(plan, rubric).map(topic => [topic.id, topic]));
            legacyTopics = topicOrder.flatMap(id => planned.get(id) ?? []);
        }
        const projection = !role && (direct || voice.promptVersion === NATIVE_VOICE_VERSION) ? nativeInterview(legacyTopics,
            direct ? roleVoiceTurns(voice.fragments) : nativeVoiceTurns(voice.fragments), delivery, +(voice.endedAt ?? voice.startedAt), interrupted, direct) : undefined;
        const notes = projection ? taraInterviewReport(projection.progress, legacyTopics) : !role && progress ? taraInterviewReport(progress, topics) : undefined;
        const turns = direct ? roleVoiceTurns(voice.fragments) : projection?.evidenceTurns ?? voiceTurns(voice.fragments);
        return evaluateTakaInterview(this.db, this.client, workId, voice.session, voice.session.invitation,
            frozenTakaInterview(voice.session.invitation.snapshot, (voice.session.package.promptSnapshot as unknown as PromptRegistry)?.takaInterview),
            plan, role ? [] : liveTakaTurns(turns, projection ? new Date(projection.origin) : voice.startedAt, voice.transcriptComplete, notes),
            { owner, notes, rubric, interrupted, role, reassess: reassessment ? { previous: reassessment.previous,
                savedResponseOnly: reassessment.savedResponseOnly, verify: async tx => {
                await tx.$queryRaw`SELECT id FROM "VoiceInterview" WHERE id=${voice.id} FOR UPDATE`;
                const current = await tx.voiceInterview.findUnique({ where: { id: voice.id }, include: takaVoiceInput });
                return takaReassessment(current)?.key === reassessment.key;
            } } : undefined, ...(completion ? { completion: { value: completion, lastEndedAt: last.endedAt ?? last.startedAt,
                replacementUsed: resumed.length > 0, cannotResume: completion.reason === 'CONNECTION_UNCONFIRMED' } } : {}),
            voice: { closeReason: last.closeReason, transcriptComplete: [voice, ...resumed].every(row => row.transcriptComplete),
                durationSeconds: Math.max(0, Math.round(completion?.usedVoiceMs !== undefined ? completion.usedVoiceMs / 1000 :
                    (+(last.endedAt ?? last.startedAt) - +voice.startedAt) / 1000)) } });
    }
}
