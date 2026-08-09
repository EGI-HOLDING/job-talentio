import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { backfillCompanyLogos, needsCompanyLogoBackfill } from '../common/company-logo-backfill';

@Injectable()
export class CompanyLogoBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CompanyLogoBackfillService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private uploader() {
    return {
      putObject: (key: string, buffer: Buffer, contentType: string) =>
        this.storage.putObject(key, buffer, contentType),
      publicUrlForKey: (key: string) => this.storage.publicUrlForKey(key),
    };
  }

  async onApplicationBootstrap() {
    try {
      const uploader = this.uploader();
      const needs = await needsCompanyLogoBackfill(this.prisma, uploader);
      if (!needs) return;
      this.logger.log('Company logos outdated - uploading demo assets to object storage');
      const result = await backfillCompanyLogos(this.prisma, uploader, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `Company logo backfill done: uploaded=${result.uploaded} updated=${result.updated}`,
      );
    } catch (err) {
      this.logger.error(
        `Company logo backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
