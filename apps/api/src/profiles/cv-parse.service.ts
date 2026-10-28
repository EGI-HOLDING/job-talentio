import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { Prisma } from '@prisma/client';
import { PrismaService } from "../prisma/prisma.service";
import { ACTIVE_CATALOG } from "../common/catalog-visibility";
import { StorageService } from "../storage/storage.service";
import {
  CV_PARSE_PROVIDER,
  type CvParseProvider,
} from "./parse/cv-parse.provider";
export const CV_PARSE_QUEUE = "cv-parse";
export const CV_PARSE_TIMEOUT_MS = 180_000;
const CV_PARSE_LEASE_MS = CV_PARSE_TIMEOUT_MS + 30_000;
export type CvParseJobPayload = { resumeId: string; generation?: number };
@Injectable()
export class CvParseService {
  private readonly logger = new Logger(CvParseService.name);
  private queue: Queue<CvParseJobPayload> | null = null;
  private activeParses = 0;
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @Inject(CV_PARSE_PROVIDER) private provider: CvParseProvider,
  ) {}
  setQueue(queue: Queue<CvParseJobPayload>) {
    this.queue = queue;
  }
  async enqueue(resumeId: string) {
    const pending = await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        parseGeneration: { increment: 1 },
        parseStatus: "PENDING",
        parseError: null,
        parseStartedAt: null,
        parsedData: Prisma.DbNull,
        parsedAt: null,
      },
    });
    if (this.queue) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.queue.add(
            "parse",
            { resumeId, generation: pending.parseGeneration },
            {
              jobId: `cv-${resumeId}-${pending.parseGeneration}`,
              attempts: 2,
              backoff: { type: "exponential", delay: 2000 },
              removeOnComplete: 100,
              removeOnFail: 50,
            },
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("CV queue timed out")),
              4000,
            );
          }),
        ]);
        // A queue can accept jobs while its worker is disconnected. The claim
        // below makes this recovery safe even if the worker starts concurrently.
        const watchdog = setTimeout(() => {
          void this.processResume(resumeId, pending.parseGeneration).catch(
            (err) => this.logger.warn(err.message),
          );
        }, 12000);
        watchdog.unref();
        return;
      } catch (err) {
        this.logger.warn(
          `Queue unavailable, parsing in-process: ${(err as Error).message}`,
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    setImmediate(() => {
      void this.processResume(resumeId, pending.parseGeneration).catch((err) =>
        this.logger.warn(err.message),
      );
    });
  }
  async processResume(resumeId: string, generation?: number) {
    // Queue watchdogs and Redis fallback share the same resource budget as the
    // queue worker. Durable PENDING rows not claimed here are picked up by the
    // periodic recovery sweep after capacity becomes available.
    if (this.activeParses >= 2) return;
    this.activeParses++;
    try { await this.processClaimedResume(resumeId, generation); }
    finally { this.activeParses--; }
  }
  private async processClaimedResume(resumeId: string, generation?: number) {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
    });
    if (!resume || resume.deletedAt || !resume.fileKey) return;
    const currentGeneration = generation ?? resume.parseGeneration;
    const where = {
      id: resumeId,
      parseGeneration: currentGeneration,
      fileKey: resume.fileKey,
      deletedAt: null,
    };
    const claimed = await this.prisma.resume.updateMany({
      where: { ...where, parseStatus: { in: ["PENDING", "FAILED"] } },
      data: { parseStatus: "PROCESSING", parseError: null, parseStartedAt: new Date() },
    });
    if (!claimed.count) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const parsed = await Promise.race([
        this.readResume(resume.fileKey),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CV parsing timed out; try again or enter details manually')), CV_PARSE_TIMEOUT_MS); }),
      ]);
      const hasData = Boolean(parsed.headline?.trim() || parsed.summary?.trim() || parsed.phone?.trim() || parsed.skillNames?.length || parsed.experiences?.length || parsed.educations?.length || parsed.languages?.length);
      if (!parsed.textPreview?.trim() || !hasData) throw new Error('No readable CV data found. Try another file or enter your experience manually.');
      await this.prisma.resume.updateMany({
        where,
        data: { parsedData: parsed as object, content: parsed.textPreview, parseStatus: 'READY', parseError: null, parsedAt: new Date(), parseStartedAt: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CV parse failed';
      await this.prisma.resume.updateMany({ where, data: { parseStatus: 'FAILED', parseError: message.slice(0, 500), parseStartedAt: null } });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Recover durable work after a process restart, lost queue job or dead worker. */
  async recoverStale() {
    const stale = {
      deletedAt: null,
      fileKey: { not: null },
      OR: [
        { parseStatus: 'PENDING' as const, updatedAt: { lt: new Date(Date.now() - 15_000) } },
        { parseStatus: 'PROCESSING' as const, parseStartedAt: { lt: new Date(Date.now() - CV_PARSE_LEASE_MS) } },
        { parseStatus: 'PROCESSING' as const, parseStartedAt: null, updatedAt: { lt: new Date(Date.now() - CV_PARSE_LEASE_MS) } },
      ],
    };
    const rows = await this.prisma.resume.findMany({ where: stale, take: 2, orderBy: { updatedAt: 'asc' }, select: { id: true, parseGeneration: true } });
    await Promise.all(rows.map(async row => {
      const claimed = await this.prisma.resume.updateMany({
        where: { ...stale, id: row.id, parseGeneration: row.parseGeneration },
        data: { parseGeneration: { increment: 1 }, parseStatus: 'PENDING', parseStartedAt: null, parsedData: Prisma.DbNull, parsedAt: null },
      });
      if (claimed.count) await this.processResume(row.id, row.parseGeneration + 1).catch(error => this.logger.warn(error.message));
    }));
  }

  private async readResume(fileKey: string) {
      const [knownSkills, knownLanguages] = await Promise.all([
        this.prisma.skill.findMany({
          where: ACTIVE_CATALOG,
          select: {
            name: true,
            slug: true,
            aliases: { select: { alias: true, aliasKey: true } },
          },
        }),
        this.prisma.language.findMany({
          where: ACTIVE_CATALOG,
          select: {
            name: true,
            code: true,
            aliases: { select: { alias: true, aliasKey: true } },
          },
        }),
      ]);
      const filename = fileKey.split("/").pop() || "cv.pdf";
      const mimeType = filename.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : filename.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/msword";
      const buffer = await this.storage.getObjectBuffer(fileKey);
      return this.provider.parse({
        buffer,
        filename,
        mimeType,
        knownSkills,
        knownLanguages,
      });
  }
}
