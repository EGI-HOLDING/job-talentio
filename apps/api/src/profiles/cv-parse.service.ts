import { Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { cvFacts, cvExperienceYears,registerCvVersion,type CvFacts } from './cv-evidence';
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
export type CvParseJobPayload = { resumeId: string|null; generation?: number; versionId?: string };
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
    const work=await this.prisma.$transaction(async tx=>{
      const owner=await tx.resume.findUniqueOrThrow({where:{id:resumeId},select:{profileId:true}});
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${owner.profileId} FOR UPDATE`);
      const resume=await tx.resume.findUniqueOrThrow({where:{id:resumeId}});
      if(!resume.fileKey||resume.deletedAt)return null;
      const version=await registerCvVersion(tx,resume.id,resume.fileKey);
      const pending = await tx.resume.update({
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
      await tx.resumeVersion.update({where:{id:version.id},data:{parseGeneration:pending.parseGeneration,parseStatus:'PENDING',parseStartedAt:null,parseError:null}});
      return {pending,version};
    });
    if(!work)return;
    const {pending,version}=work;
    if (this.queue) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.queue.add(
            "parse",
            { resumeId, generation: pending.parseGeneration, versionId:version.id },
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
          void this.processResume(resumeId, pending.parseGeneration,version.id).catch(
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
      void this.processResume(resumeId, pending.parseGeneration,version.id).catch((err) =>
        this.logger.warn(err.message),
      );
    });
  }
  async processResume(resumeId: string|null, generation?: number,versionId?:string) {
    // Queue watchdogs and Redis fallback share the same resource budget as the
    // queue worker. Durable PENDING rows not claimed here are picked up by the
    // periodic recovery sweep after capacity becomes available.
    if (this.activeParses >= 2) return;
    this.activeParses++;
    try { await this.processClaimedResume(resumeId, generation,versionId); }
    finally { this.activeParses--; }
  }
  private async processClaimedResume(resumeId: string|null, generation?: number,versionId?:string) {
    const resume = resumeId?await this.prisma.resume.findUnique({
      where: { id: resumeId },
    }):null;
    const version=versionId?await this.prisma.resumeVersion.findUnique({where:{id:versionId}}):resume?.currentVersionId?await this.prisma.resumeVersion.findUnique({where:{id:resume.currentVersionId}}):resume?.fileKey?await registerCvVersion(this.prisma,resume.id,resume.fileKey):null;
    if(!version || (version.resumeId!==null && version.resumeId!==resumeId))return;
    const currentGeneration = generation ?? version.parseGeneration;
    const where = {
      id: version.id,
      parseGeneration: currentGeneration,
      fileKey: version.fileKey,
    };
    const claimed = await this.prisma.resumeVersion.updateMany({
      where: { ...where, parseStatus: { in: ["PENDING", "FAILED"] } },
      data: { parseStatus: "PROCESSING", parseError: null, parseStartedAt: new Date() },
    });
    if (!claimed.count) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const parsed = await Promise.race([
        this.readResume(version.fileKey),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CV processing timed out; try reading the file again')), CV_PARSE_TIMEOUT_MS); }),
      ]);
      const hasData = Boolean(parsed.headline?.trim() || parsed.summary?.trim() || parsed.phone?.trim() || parsed.skillNames?.length || parsed.experiences?.length || parsed.educations?.length || parsed.languages?.length);
      if (!parsed.textPreview?.trim() || !hasData) throw new Error('CV saved, but no readable career data was found. Try reading it again or upload another file.');
      const catalog=await this.prisma.skill.findMany({where:ACTIVE_CATALOG,include:{aliases:{select:{aliasKey:true}}}});
      const normalized=cvFacts(parsed,catalog,version.id);
      await this.prisma.resumeVersion.updateMany({
        where,
        data: { ...normalized,parsedData: parsed as object, parseStatus: 'READY', parseError: null, parsedAt: new Date(), parseStartedAt: null },
      });
      if(resumeId)await this.prisma.resume.updateMany({where:{id:resumeId,currentVersionId:version.id,parseGeneration:currentGeneration},data:{parsedData:parsed as object,content:parsed.textPreview,parseStatus:'READY',parseError:null,parsedAt:new Date(),parseStartedAt:null}});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CV parse failed';
      await this.prisma.resumeVersion.updateMany({ where, data: { parseStatus: 'FAILED', parseError: message.slice(0, 500), parseStartedAt: null } });
      if(resumeId)await this.prisma.resume.updateMany({where:{id:resumeId,currentVersionId:version.id,parseGeneration:currentGeneration},data:{parseStatus:'FAILED',parseError:message.slice(0,500),parseStartedAt:null}});
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Recover durable work after a process restart, lost queue job or dead worker. */
  async recoverStale() {
    const versionRows=await this.prisma.resumeVersion.findMany({where:{OR:[{parseStatus:'PENDING'},{parseStatus:'PROCESSING',parseStartedAt:{lt:new Date(Date.now()-CV_PARSE_LEASE_MS)}}]},take:2,orderBy:{updatedAt:'asc'}});
    for(const row of versionRows){
      if(row.parseStatus==='PROCESSING')await this.prisma.resumeVersion.updateMany({where:{id:row.id,parseGeneration:row.parseGeneration,parseStatus:'PROCESSING',parseStartedAt:{lt:new Date(Date.now()-CV_PARSE_LEASE_MS)}},data:{parseStatus:'PENDING'}});
      await this.processResume(row.resumeId,row.parseGeneration,row.id).catch(error=>this.logger.warn(error.message));
    }
    const legacy=await this.prisma.resume.findMany({where:{currentVersionId:null,deletedAt:null,fileKey:{not:null}},take:2,select:{id:true}});
    for(const row of legacy)await this.enqueue(row.id).catch(error=>this.logger.warn(error.message));
    // Keep indexed experience filters aligned with current-date scoring without
    // downloading or parsing the same file again.
    const today=new Date();today.setUTCHours(0,0,0,0);
    const ongoing=await this.prisma.resumeVersion.findMany({where:{parseStatus:'READY',updatedAt:{lt:today},matchingData:{path:['experiences'],array_contains:[{isCurrent:true}]}},take:100,select:{id:true,parseGeneration:true,matchingData:true}});
    for(const row of ongoing)await this.prisma.resumeVersion.updateMany({where:{id:row.id,parseStatus:'READY',parseGeneration:row.parseGeneration},data:{experienceYears:cvExperienceYears((row.matchingData as CvFacts).experiences)}});
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
      await this.prisma.resumeVersion.updateMany({where:{fileKey,checksum:null},data:{checksum:createHash('sha256').update(buffer).digest('hex')}});
      return this.provider.parse({
        buffer,
        filename,
        mimeType,
        knownSkills,
        knownLanguages,
      });
  }
}
