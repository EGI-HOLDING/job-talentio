import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_OBJECT_PREFIX, StorageService } from '../storage/storage.service';

/**
 * One-shot migrate: User.avatarUrl pointing at private `avatars/*`
 * → copy object to `public/avatars/*` and update that user row.
 */
@Injectable()
export class AvatarBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AvatarBackfillService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const result = await this.migratePrivateAvatars();
      if (result.candidates === 0) return;
      this.logger.log(
        `Avatar backfill done: candidates=${result.candidates} migrated=${result.migrated} failed=${result.failed}`,
      );
    } catch (err) {
      this.logger.error(
        `Avatar backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async migratePrivateAvatars(): Promise<{
    candidates: number;
    migrated: number;
    failed: number;
  }> {
    const users = await this.prisma.user.findMany({
      where: { avatarUrl: { not: null } },
      select: { id: true, email: true, avatarUrl: true },
    });

    let candidates = 0;
    let migrated = 0;
    let failed = 0;

    for (const user of users) {
      const oldKey = this.storage.privateAvatarKeyFromUrl(user.avatarUrl);
      if (!oldKey) continue;
      candidates += 1;

      const newKey = `${PUBLIC_OBJECT_PREFIX}${oldKey}`; // public/avatars/...
      const newUrl = this.storage.publicUrlForKey(newKey);

      try {
        await this.storage.copyObject(oldKey, newKey);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl: newUrl },
        });
        await this.storage.delete(oldKey);
        migrated += 1;
        this.logger.log(`Migrated avatar user=${user.id} email=${user.email} → ${newKey}`);
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Avatar migrate skipped user=${user.id} key=${oldKey}: ${(err as Error).message}`,
        );
      }
    }

    return { candidates, migrated, failed };
  }
}
