import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeCatalogSnapshot } from '../matching/employee-catalog-snapshot';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { PositionCatalogService } from '../matching/position-catalog.service';
import { PositionGroupService } from '../matching/position-group.service';
import { PositionSearchIndex } from '../matching/position-search-index';

async function main() {
  await ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'] });
  const db = new PrismaService();
  try {
    const groups = new PositionGroupService(db, new OccupationRelationsService(db));
    const index = new PositionSearchIndex(new ConfigService());
    const positions = new PositionCatalogService(new EmployeeCatalogSnapshot(db), groups, index, db);
    const { revision, documents, groupReleaseVersion } = await positions.snapshot();
    const uid = await index.prepare(revision, documents);
    console.log(JSON.stringify({ index: uid, revision, documents: documents.length, groupReleaseVersion }));
  } finally {
    await db.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
