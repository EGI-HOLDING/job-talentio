import { Module } from '@nestjs/common';
import { BulkCommsController } from './bulk-comms.controller';
import { BulkCommsService } from './bulk-comms.service';
import { CompaniesModule } from '../companies/companies.module';
import { ApplicationsModule } from '../applications/applications.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [CompaniesModule, ApplicationsModule, ChatModule],
  controllers: [BulkCommsController],
  providers: [BulkCommsService],
  exports: [BulkCommsService],
})
export class BulkCommsModule {}
