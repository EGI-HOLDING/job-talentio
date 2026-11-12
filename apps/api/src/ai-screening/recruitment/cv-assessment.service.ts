import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiScreeningCall, type AiScreeningWork, type RecruitmentCandidate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { hash, json } from '../screening.policy';
import { CV_ALERT_MS, CV_DELAYED_MS, CV_MAX_SUBMISSIONS, CV_PROVIDER_TASK, CV_RECOVERY_VERSION, CV_RESPONSE_FORMAT, CvWorkDelay,
  completeCvSource, cvReadTargets, cvRequest, decodeCvResponse, mergeCvGrades, mergeCvSource, projectCvScore, readCvSource,
  type CvCheckpoint, type CvProgress } from './cv-assessment';
import { queueCvProviderCleanup, queueCvProviderWork, saveCvAssessment } from './cv-assessment-store';
import { prepareCvDocument, CV_MAX_BYTES } from './cv-document';
import { CvProvider, cvBackoff, cvRejection, cvTerminal, cvUsage, isCvResponseId, type CvHttp } from './cv-provider';
import { CV_RUBRIC } from './cv-scoring.policy';

type Run = { work: AiScreeningWork; owner: string; row: RecruitmentCandidate };
type CallTrace = { pollFailures?: number; providerRequestId?: string | null; acknowledgedAt?: string;
  firstInProgressAt?: string; providerCreatedAt?: number; providerCompletedAt?: number; lastStatus?: string };
const pendingStatus = ['SENDING', 'RUNNING', 'UNCERTAIN'];
const progress = (phase: CvProgress['phase']): CvProgress => ({ phase, updatedAt: new Date().toISOString() });
const candidateFence = (row: RecruitmentCandidate) => ({ id: row.id, revision: row.revision, fileKey: row.fileKey, scoreStatus: 'PROCESSING' });
const workFence = (run: Run) => ({ id: run.work.id, leaseOwner: run.owner, status: 'RUNNING' });
const trace = (call: AiScreeningCall): CallTrace => (call.usage as { trace?: CallTrace } | null)?.trace ?? {};

@Injectable()
export class CvAssessmentService {
  private readonly logger = new Logger(CvAssessmentService.name);
  constructor(private readonly db: PrismaService, private readonly storage: StorageService, private readonly config: ConfigService,
    private readonly provider: CvProvider) {}

  async process(work: AiScreeningWork, owner: string, row: RecruitmentCandidate) {
    const run = { work, owner, row };
    let checkpoint = work.cvCheckpoint as CvCheckpoint | null;
    const call = await this.db.aiScreeningCall.findFirst({ where: { workId: work.id, task: CV_PROVIDER_TASK },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (checkpoint && checkpoint.responseFormat !== CV_RESPONSE_FORMAT || call && !checkpoint)
      return this.halt(run, 'CV_RETIRED_FORMAT_REQUIRES_REVIEW');
    if (call && checkpoint && checkpoint.consumed !== call.id) {
      if (pendingStatus.includes(call.status)) return this.observe(run, checkpoint, call);
      return this.consume(run, checkpoint, call);
    }
    if (checkpoint && completeCvSource(checkpoint.source, checkpoint.expectedPages) &&
      (!row.jobSnapshot || checkpoint.grades.length === CV_RUBRIC.length)) return this.finish(run, checkpoint);
    if (!this.provider.configured) return this.halt(run, 'PROVIDER_NOT_CONFIGURED');

    const sent = await this.db.aiScreeningCall.count({ where: { workId: work.id, task: CV_PROVIDER_TASK } });
    if (sent - (checkpoint?.cycleFrom ?? 0) >= CV_MAX_SUBMISSIONS) return this.halt(run, 'CV_RECOVERY_ATTEMPTS_EXHAUSTED');

    let document;
    if (checkpoint?.stage !== 'GRADE') {
      try {
        const buffer = await this.storage.getObjectBuffer(row.fileKey!, CV_MAX_BYTES);
        const canRecoverWordImages = checkpoint?.stage === 'READ' && checkpoint.wordVisualFallback;
        const targets = checkpoint?.stage === 'READ' && !canRecoverWordImages
          ? cvReadTargets(checkpoint.source, checkpoint.expectedPages) : [];
        document = await prepareCvDocument(buffer, row.filename, row.fileKey!, this.config.get('CV_WORD_RENDERER_URL'),
          canRecoverWordImages ? undefined : checkpoint?.fileKind, targets);
        if (canRecoverWordImages && checkpoint && document.fileKind === 'WORD_VISUAL') {
          checkpoint = { ...checkpoint, fileKind: document.fileKind, expectedPages: document.pages, wordVisualFallback: false,
            source: undefined, grades: [], unreadableReads: 0 };
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (/^CV_FILE_(INVALID|SIZE)$|^Invalid or oversized DOCX archive$/.test(code)) return this.halt(run, 'CV_FILE_INVALID', true);
        throw error;
      }
      if (document.checksum !== (checkpoint?.checksum ?? row.checksum ?? document.checksum) ||
        (checkpoint && (checkpoint.fileKind !== document.fileKind || checkpoint.expectedPages !== document.pages))) return this.halt(run, 'CV_SOURCE_CHANGED');
    }
    checkpoint ??= { stage: 'INITIAL', responseFormat: CV_RESPONSE_FORMAT, model: this.config.get<string>('CV_SCORING_MODEL')?.trim() || 'gpt-6-luna',
      checksum: document!.checksum, expectedPages: document!.pages, fileKind: document!.fileKind,
      wordVisualFallback: document!.wordVisualFallback, grades: [] };
    const spec = cvRequest(checkpoint, row.jobSnapshot, document?.pagesInFile);
    const estimatedTokens = spec.maxOutput + Math.ceil(JSON.stringify(spec.data).length / 3) +
      (document ? (document.pagesInFile.length || document.pages || 10) * 2600 + 2000 : 1000);
    await this.setProgress(run, checkpoint.stage === 'INITIAL' ? 'READING' : 'REPAIRING');
    const reserved = await this.reserve(run, checkpoint, sent, estimatedTokens, spec.data);
    if (!reserved) return;
    const response = await this.provider.create(reserved.id, checkpoint.model, spec, document?.file);
    if (response.status >= 200 && response.status < 300 && isCvResponseId(response.body?.id)) {
      const retained = await this.record(reserved, response);
      if (!retained) return;
      if (retained.status === 'RUNNING') throw new CvWorkDelay(3000);
      return this.consume(run, checkpoint, retained);
    }

    const disposition = cvRejection(response);
    const delay = disposition === 'RETRYABLE' ? cvBackoff(sent - (checkpoint.cycleFrom ?? 0), response.retryAfter) : 0;
    const changed = await this.db.aiScreeningCall.updateMany({
      where: { id: reserved.id, status: 'SENDING', responseId: null },
      data: { status: disposition === 'UNCONFIRMED' ? 'UNCERTAIN' : 'FAILED',
        error: disposition === 'UNCONFIRMED' ? 'CREATE_RESPONSE_UNCONFIRMED' : disposition === 'RETRYABLE' ? 'PROVIDER_RETRYABLE_REJECTION' : 'PROVIDER_REQUEST_BLOCKED',
        usage: json({ trace: { providerRequestId: response.requestId, lastStatus: 'http_' + response.status } }),
        ...(delay ? { cvCooldownUntil: new Date(Date.now() + delay) } : {}),
      },
    });
    if (!changed.count) throw new CvWorkDelay(2000); // Webhook or erasure won the race.
    if (disposition === 'BLOCKED') {
      if (await this.store(run, { ...checkpoint, consumed: reserved.id })) return this.halt(run, 'PROVIDER_REQUEST_BLOCKED');
      return;
    }
    if (disposition === 'UNCONFIRMED') await this.setProgress(run, 'RECOVERING');
    throw new CvWorkDelay(delay || 30000);
  }

  private async reserve(run: Run, checkpoint: CvCheckpoint, sent: number, estimatedTokens: number, data: unknown) {
    const rpm = this.limit('CV_SCORING_V2_RPM', 30), tpm = this.limit('CV_SCORING_V2_TPM', 200000);
    // A large estimate reserves the entire window. The provider enforces its exact token limit.
    const tokens = Math.min(estimatedTokens, tpm);
    return this.db.$transaction(async tx => {
      const candidate = await tx.recruitmentCandidate.findFirst({ where: candidateFence(run.row), select: { id: true } });
      if (!candidate || !(await tx.aiScreeningWork.updateMany({ where: workFence(run), data: { cvCheckpoint: json(checkpoint) } })).count) return null;
      // A shared transaction lock keeps all processes on this project within the same rolling budget.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(79642131)`;
      const now = Date.now();
      const [recent, cooldown] = await Promise.all([
        tx.aiScreeningCall.findMany({ where: { task: CV_PROVIDER_TASK, createdAt: { gt: new Date(now - 60000) } },
          orderBy: { createdAt: 'asc' }, select: { createdAt: true, cvTokenReservation: true } }),
        tx.aiScreeningCall.findFirst({ where: { task: CV_PROVIDER_TASK, cvCooldownUntil: { gt: new Date(now) } },
          orderBy: { cvCooldownUntil: 'desc' }, select: { cvCooldownUntil: true } }),
      ]);
      if (cooldown?.cvCooldownUntil) throw new CvWorkDelay(+cooldown.cvCooldownUntil - now + 100);
      if (recent.length >= rpm || recent.reduce((sum, attempt) => sum + (attempt.cvTokenReservation ?? 0), tokens) > tpm)
        throw new CvWorkDelay(Math.max(1000, +recent[0].createdAt + 60100 - now));
      return tx.aiScreeningCall.create({ data: {
        key: run.work.id + ':cv2:' + sent, workId: run.work.id, subjectId: run.row.id, task: CV_PROVIDER_TASK,
        model: checkpoint.model, promptVersion: CV_RECOVERY_VERSION, inputHash: hash([checkpoint.checksum, checkpoint.stage, data]),
        cvTokenReservation: tokens, status: 'SENDING',
      } });
    });
  }

  private limit(key: string, fallback: number) {
    const value = Number(this.config.get(key));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private async observe(run: Run, checkpoint: CvCheckpoint, call: AiScreeningCall) {
    const elapsed = Date.now() - +call.createdAt;
    if (elapsed >= CV_ALERT_MS && !checkpoint.alertAt) {
      checkpoint = { ...checkpoint, alertAt: new Date().toISOString() };
      const saved = await this.store(run, checkpoint);
      if (!saved) return;
      this.logger.warn('Taka CV provider delayed work=' + run.work.id + ' attempt=' + call.id + ' response=' + (call.responseId ?? 'unknown'));
    }
    if (!call.responseId) {
      await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: 'SENDING', responseId: null },
        data: { status: 'UNCERTAIN', error: 'CREATE_RESPONSE_UNCONFIRMED' } });
      await this.setProgress(run, 'RECOVERING');
      throw new CvWorkDelay(60000);
    }
    const response = await this.provider.get(call.responseId);
    if (response.status >= 200 && response.status < 300 && response.body?.id === call.responseId) {
      const observed = await this.record(call, response);
      if (!observed) return;
      if (observed.status === 'RUNNING') {
        if (elapsed >= CV_DELAYED_MS) await this.setProgress(run, 'DELAYED');
        throw new CvWorkDelay(elapsed >= CV_ALERT_MS ? 60000 : elapsed >= CV_DELAYED_MS ? 15000 : 3000);
      }
      return this.consume(run, checkpoint, observed);
    }
    const failures = (trace(call).pollFailures ?? 0) + 1;
    await this.db.aiScreeningCall.updateMany({ where: { id: call.id, status: { in: pendingStatus } },
      data: { usage: json({ trace: { ...trace(call), pollFailures: failures, providerRequestId: response.requestId ?? trace(call).providerRequestId } }) } });
    if ([401, 403, 404, 410].includes(response.status)) await this.setProgress(run, 'RECOVERING');
    else if (elapsed >= CV_DELAYED_MS) await this.setProgress(run, 'DELAYED');
    throw new CvWorkDelay(cvBackoff(failures, response.retryAfter));
  }

  private async record(call: AiScreeningCall, response: CvHttp) {
    const body = response.body!;
    const id = body.id!;
    const waiting = !['completed', 'failed', 'incomplete', 'cancelled'].includes(body.status ?? '');
    const next: { error?: string; result?: unknown } = waiting ? {} : cvTerminal(body);
    const usage = { trace: { ...trace(call), acknowledgedAt: trace(call).acknowledgedAt ?? new Date().toISOString(),
      firstInProgressAt: trace(call).firstInProgressAt ?? (body.status === 'in_progress' ? new Date().toISOString() : undefined),
      providerRequestId: response.requestId ?? trace(call).providerRequestId, pollFailures: 0,
      providerCreatedAt: body.created_at, providerCompletedAt: body.completed_at, lastStatus: body.status }, ...(body.usage ?? {}) };
    return this.db.$transaction(async tx => {
      const updated = await tx.aiScreeningCall.updateMany({
        where: { id: call.id, status: { in: pendingStatus }, OR: [{ responseId: null }, { responseId: id }] },
        data: { responseId: id, status: waiting ? 'RUNNING' : next.error ? 'FAILED' : 'COMPLETED', error: next.error ?? null,
          ...(waiting ? {} : { result: next.result == null ? Prisma.DbNull : json(next.result), ...cvUsage(body, call.model) }), usage: json(usage) },
      });
      if (!waiting || !updated.count) {
        const current = await tx.aiScreeningCall.findUnique({ where: { id: call.id }, select: { status: true, responseId: true } });
        if ((!waiting && updated.count) || current?.status === 'ERASED') await queueCvProviderWork(tx, 'CV_PROVIDER_DELETE', id);
      }
      return updated.count ? tx.aiScreeningCall.findUnique({ where: { id: call.id } }) : null;
    });
  }

  private async consume(run: Run, checkpoint: CvCheckpoint, call: AiScreeningCall) {
    const next: CvCheckpoint = { ...checkpoint, consumed: call.id, alertAt: undefined };
    if (call.status !== 'COMPLETED') {
      if (['PROVIDER_REFUSAL', 'PROVIDER_REQUEST_BLOCKED', 'PROVIDER_INCOMPLETE'].includes(call.error ?? '')) {
        if (await this.store(run, next)) return this.halt(run, call.error!);
        return;
      }
      if (['PROVIDER_OUTPUT_LIMIT', 'INVALID_PROVIDER_OUTPUT'].includes(call.error ?? '')) {
        if (next.stage === 'INITIAL') next.stage = 'READ';
        else {
          if (await this.store(run, next)) return this.halt(run, call.error!);
          return;
        }
      }
    } else {
      const { source: returned, targets, grades } = decodeCvResponse(checkpoint, call.result as { source?: unknown; grades?: unknown } | null);
      if (checkpoint.stage !== 'GRADE') {
        if (returned) {
          const merged = readCvSource(mergeCvSource(checkpoint.source, returned, targets), checkpoint.expectedPages);
          if (merged) next.source = merged;
          if (!returned.readable && !returned.blocks.length) next.unreadableReads = (checkpoint.unreadableReads ?? 0) + 1;
        }
        if (!completeCvSource(next.source, next.expectedPages)) {
          const pages = next.source?.pages;
          const empty = pages?.length && pages.every(row => row.status === 'EMPTY') && !cvReadTargets(next.source, next.expectedPages).length;
          if (empty) return this.halt(run, 'CV_DOCUMENT_EMPTY', true);
          if ((next.unreadableReads ?? 0) >= 2 && !next.source?.blocks.length) return this.halt(run, 'CV_DOCUMENT_UNREADABLE', true);
          if (checkpoint.stage === 'READ' &&
            (!next.source || (checkpoint.source && cvReadTargets(next.source, next.expectedPages).length >= targets.length))) {
            if (await this.store(run, next)) return this.halt(run, 'CV_READ_REPAIR_NO_PROGRESS');
            return;
          }
          next.stage = 'READ';
        } else {
          next.grades = run.row.jobSnapshot ? mergeCvGrades(next.source!, [], grades) : [];
          next.stage = 'GRADE';
        }
      } else {
        next.grades = mergeCvGrades(next.source!, next.grades, grades);
        if (next.grades.length === checkpoint.grades.length) {
          if (await this.store(run, next)) return this.halt(run, 'CV_GRADE_REPAIR_NO_PROGRESS');
          return;
        }
      }
    }
    if (!(await this.store(run, next))) return;
    if (completeCvSource(next.source, next.expectedPages) && (!run.row.jobSnapshot || next.grades.length === CV_RUBRIC.length))
      return this.finish(run, next);
    await this.setProgress(run, 'REPAIRING');
    throw new CvWorkDelay(call.cvCooldownUntil ? Math.max(1000, +call.cvCooldownUntil - Date.now()) : 1000);
  }

  private async store(run: Run, checkpoint: CvCheckpoint) {
    return (await this.db.aiScreeningWork.updateMany({ where: workFence(run), data: { cvCheckpoint: json(checkpoint) } })).count > 0;
  }

  private async setProgress(run: Run, phase: CvProgress['phase']) {
    if ((run.row.cvProgress as CvProgress | null)?.phase === phase) return;
    await this.db.recruitmentCandidate.updateMany({ where: candidateFence(run.row), data: { cvProgress: json(progress(phase)) } });
  }

  private async finish(run: Run, checkpoint: CvCheckpoint) {
    const checked = projectCvScore(checkpoint.source!, checkpoint.grades, Boolean(run.row.jobSnapshot), Boolean(checkpoint.wordVisualFallback));
    await this.db.$transaction(async tx => {
      // Taking the candidate lock first matches the ordering of job edits and retries.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "RecruitmentCandidate" WHERE id=${run.row.id} FOR UPDATE`;
      if (!rows.length || !(await tx.aiScreeningWork.updateMany({ where: workFence(run), data: { cvCheckpoint: Prisma.DbNull } })).count) return;
      await saveCvAssessment(tx, run.row, run.work.id, checkpoint.checksum, checked, CV_RECOVERY_VERSION, {
        phase: run.row.jobSnapshot ? 'READY' : 'EXTRACTED',
        sourceReferences: { ...checked.sourceReferences, fileKind: checkpoint.fileKind, checksum: checkpoint.checksum,
          model: checkpoint.model, responseFormat: checkpoint.responseFormat },
      });
    });
  }

  async halt(run: Run, code: string, documentRequired = false) {
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "RecruitmentCandidate" WHERE id=${run.row.id} FOR UPDATE`;
      const held = await tx.aiScreeningWork.updateMany({ where: workFence(run), data: { status: 'FAILED', error: code, leaseOwner: null, leaseUntil: null } });
      if (!held.count) return;
      const changed = await tx.recruitmentCandidate.updateMany({ where: candidateFence(run.row), data: {
        scoreStatus: documentRequired ? 'UNREADABLE' : 'FAILED', cvProgress: json(progress(documentRequired ? 'DOCUMENT_REQUIRED' : 'RECOVERING')),
        error: documentRequired ? 'CV belum dapat dibaca. Unggah berkas yang bisa dibuka dan dibaca.' : 'Penilaian CV perlu dipulihkan. Berkas dan bukti yang sudah diproses tersimpan.',
      } });
      if (changed.count) await tx.candidateActivity.create({ data: { candidateId: run.row.id, kind: documentRequired ? 'CV_UNREADABLE' : 'CV_RECOVERY_REQUIRED',
        detail: json({ code, workId: run.work.id }) } });
    });
    this.logger.warn('Taka CV ' + code + ' work=' + run.work.id);
  }

  async receiveProviderEvent(responseId: string) {
    let call = await this.db.aiScreeningCall.findFirst({ where: { responseId, task: CV_PROVIDER_TASK } });
    if (!call) {
      // The completion event can arrive even when the original POST acknowledgement was lost.
      const response = await this.provider.get(responseId);
      if ([400, 404, 410].includes(response.status)) return;
      if (response.status < 200 || response.status >= 300) throw new CvWorkDelay(cvBackoff(3, response.retryAfter));
      const attempt = response.body?.metadata?.talentio_cv_attempt;
      if (response.body?.id !== responseId || !attempt) return;
      call = await this.db.aiScreeningCall.findFirst({ where: { id: attempt, task: CV_PROVIDER_TASK } });
      if (!call || (call.responseId && call.responseId !== responseId)) return;
      if (!pendingStatus.includes(call.status)) {
        if (call.status === 'ERASED') await queueCvProviderWork(this.db, 'CV_PROVIDER_DELETE', responseId);
        return;
      }
      call = await this.record(call, response);
      if (!call) return;
    }
    if (call.status === 'ERASED') return void await queueCvProviderWork(this.db, 'CV_PROVIDER_DELETE', responseId);
    // A signed notification only wakes the owning work. That worker publishes under its own lease and revision.
    await this.db.aiScreeningWork.updateMany({ where: { id: call.workId, cvPolicy: CV_RECOVERY_VERSION, status: 'PENDING' },
      data: { availableAt: new Date() } });
  }

  async deleteProviderResult(responseId: string) {
    const response = await this.provider.delete(responseId);
    if ([400, 409].includes(response.status)) {
      const observed = await this.provider.get(responseId);
      if (['queued', 'in_progress'].includes(observed.body?.status ?? '')) throw new CvWorkDelay(30000);
      if ([404, 410].includes(observed.status)) return;
    }
    if (![200, 204, 404, 410].includes(response.status)) throw new Error('CV_PROVIDER_DELETE_RETRY');
  }

  async supersede(workId: string, owner?: string) {
    await this.db.$transaction(async tx => {
      const cleared = await tx.aiScreeningWork.updateMany({ where: { id: workId, leaseOwner: owner },
        data: { cvCheckpoint: Prisma.DbNull } });
      if (cleared.count) await queueCvProviderCleanup(tx, { workId });
    });
  }
}
