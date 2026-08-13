import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminListsService } from './admin-lists.service';
import { AdminBulkService } from './admin-bulk.service';
import { AdminCatalogService } from './admin-catalog.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [AdminController],
  providers: [AdminService, AdminListsService, AdminBulkService, AdminCatalogService],
})
export class AdminModule {}
