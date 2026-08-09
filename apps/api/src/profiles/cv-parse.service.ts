import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { parseCvText, stripNullBytesDeep } from './cv-parser';

const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

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
      const isPdf = /\.pdf$/i.test(key) || key.toLowerCase().includes('.pdf');
      let parsed = parseCvText('', knownSkills);

      if (isPdf) {
        const buffer = await this.storage.getObjectBuffer(key);
        try {
          const result = await pdfParse(buffer);
          parsed = parseCvText(result.text || '', knownSkills);
        } catch {
          parsed = {
            ...parseCvText('', knownSkills),
            textPreview: 'Could not extract text from this PDF',
          };
        }
      } else {
        parsed = {
          ...parseCvText('', knownSkills),
          textPreview: 'Structured parse currently supports PDF; file is stored for download.',
        };
      }

      parsed = stripNullBytesDeep(parsed);

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
