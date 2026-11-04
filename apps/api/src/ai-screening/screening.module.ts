import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { CompaniesModule } from '../companies/companies.module';
import { MatchingModule } from '../matching/matching.module';
import { ScreeningController } from './screening.controller';
import { ScreeningSessions } from './screening-sessions.service';
import { ScreeningPackets } from './screening-packets.service';
import { ScreeningCandidatePlans } from './screening-candidate-plans.service';
import { ScreeningClient } from './screening.client';
import { ScreeningWorker } from './screening-worker.service';
import { ScreeningHr } from './screening-hr.service';
@Module({ imports: [PrismaModule, StorageModule, CompaniesModule, MatchingModule], controllers: [ScreeningController], providers: [ScreeningSessions, ScreeningPackets, ScreeningCandidatePlans, ScreeningClient, ScreeningWorker, ScreeningHr], exports: [ScreeningSessions, ScreeningPackets, ScreeningHr] })
export class ScreeningModule {
}
