import { CandidateActions } from './recruitment/candidate-actions.service';
import { CandidateActionsController } from './recruitment/candidate-actions.controller';
import { VoiceService } from './voice/voice.service';
import { VoiceProvider } from './voice/voice.provider';
import { VoiceController } from './voice/voice.controller';
import { CvScoringService } from './recruitment/cv-scoring.service';
import { RecruitmentService } from './recruitment/recruitment.service';
import { RecruitmentController } from './recruitment/recruitment.controller';
import { InvitationsService } from './recruitment/invitations.service';
import { InvitationsController } from './recruitment/invitations.controller';
import { MailModule } from '../mail/mail.module';
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
@Module({ imports: [PrismaModule, StorageModule, CompaniesModule, MatchingModule, MailModule], controllers: [CandidateActionsController, VoiceController, ScreeningController, RecruitmentController, InvitationsController], providers: [CandidateActions, VoiceService, VoiceProvider, InvitationsService, CvScoringService, RecruitmentService, ScreeningSessions, ScreeningPackets, ScreeningCandidatePlans, ScreeningClient, ScreeningWorker, ScreeningHr], exports: [InvitationsService, RecruitmentService, ScreeningSessions, ScreeningPackets, ScreeningHr] })
export class ScreeningModule {
}
