import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureSuperAdmin();
  }

  private async ensureSuperAdmin() {
    const email = (
      this.config.get('SUPERADMIN_EMAIL') ?? 'sarvar.adminov@jobtalentio.uz'
    ).toLowerCase();
    const password = this.config.get('SUPERADMIN_PASSWORD');
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== 'SUPER_ADMIN') {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { role: 'SUPER_ADMIN' },
        });
      }
      return;
    }
    if (!password || password === 'Admin123!' || password.length < 12) {
      this.logger.warn(
        'Skipping Super Admin seed: set SUPERADMIN_PASSWORD (min 12 chars, not the demo default) to create the first admin.',
      );
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: 'Sarvar Adminov',
        role: 'SUPER_ADMIN',
        emailVerified: false,
      },
    });
    this.logger.log(`Seeded Super Admin: ${email}`);
  }
}
