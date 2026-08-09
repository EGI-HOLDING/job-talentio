import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CV_PARSE_PROVIDER, type CvParseProvider } from './parse/cv-parse.provider';

export const CV_PARSE_QUEUE = 'cv-parse';

export type CvParseJobPayload = {
  resumeId: string;
};

@Injectable()
export class CvParseService {
  private readonly logger = new Logger(CvParseService.name);
  private queue: Queue<CvParseJobPayload> | null = null;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @Inject(CV_PARSE_PROVIDER) private provider: CvParseProvider,
  ) {}

  setQueue(queue: Queue<CvParseJobPayload>) {
    this.queue = queue;
  }

  /** Enqueue parse; falls back to in-process async if Redis queue is unavailable. */
  async enqueue(resumeId: string) {
    await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        parseStatus: 'PENDING',
        parseError: null,
      },
    });

    if (this.queue) {
      try {
        await this.queue.add(
          'parse',
          { resumeId },
          {
            attempts: 2,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        );
        return;
      } catch (err) {
        this.logger.warn(
          `CV parse enqueue failed for ${resumeId}: ${(err as Error).message} - falling back in-process`,
        );
      }
    } else {
      this.logger.warn(`CV parse queue unavailable - running in-process for ${resumeId}`);
    }

    setImmediate(() => {
      void this.processResume(resumeId).catch((err) =>
        this.logger.error(`In-process CV parse failed for ${resumeId}: ${err.message}`),
      );
    });
  }

  async processResume(resumeId: string) {
    const resume = await this.prisma.resume.findUnique({ where: { id: resumeId } });
    if (!resume || resume.deletedAt || !resume.fileKey) {
      return;
    }

    await this.prisma.resume.update({
      where: { id: resumeId },
      data: { parseStatus: 'PROCESSING', parseError: null },
    });

    try {
      const knownSkills = await this.prisma.skill.findMany({
        select: { name: true, slug: true },
        take: 500,
      });

      const key = resume.fileKey;
      const filename = filenameFromKey(key);
      const mimeType = mimeFromFilename(filename);
      const buffer = await this.storage.getObjectBuffer(key);

      const parsed = await this.provider.parse({
        buffer,
        filename,
        mimeType,
        knownSkills,
      });

      await this.prisma.resume.update({
        where: { id: resumeId },
        data: {
          parsedData: parsed as object,
          content: parsed.textPreview || resume.content,
          parseStatus: 'READY',
          parseError: null,
          parsedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CV parse failed';
      this.logger.warn(`CV parse failed for ${resumeId}: ${message}`);
      await this.prisma.resume.update({
        where: { id: resumeId },
        data: {
          parseStatus: 'FAILED',
          parseError: message.slice(0, 500),
        },
      });
    }
  }
}

function filenameFromKey(key: string): string {
  const base = key.split('/').pop() || key;
  // keys look like: uuid-original_name.pdf
  const dash = base.indexOf('-');
  return dash >= 0 ? base.slice(dash + 1) : base;
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}
