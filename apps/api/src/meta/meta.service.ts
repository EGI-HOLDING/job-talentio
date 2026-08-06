import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService) {}

  skills(q?: string, category?: string) {
    return this.prisma.skill.findMany({
      where: {
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  cities(q?: string) {
    return this.prisma.city.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  categories() {
    return this.prisma.jobCategory.findMany({ orderBy: { name: 'asc' } });
  }

  industries() {
    return this.prisma.industry.findMany({ orderBy: { name: 'asc' } });
  }

  benefits() {
    return this.prisma.benefit.findMany({ orderBy: { name: 'asc' } });
  }

  languages() {
    return this.prisma.language.findMany({ orderBy: { name: 'asc' } });
  }
}
