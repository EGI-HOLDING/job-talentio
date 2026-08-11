import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';

/** Global so chat/profile services can embed presence without import churn. */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
