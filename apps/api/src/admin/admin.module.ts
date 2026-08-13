import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminListsService } from './admin-lists.service';
import { AdminBulkService } from './admin-bulk.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminUsersService } from './admin-users.service';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [BillingModule, AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminService, AdminListsService, AdminBulkService, AdminCatalogService, AdminUsersService],
})
export class AdminModule {}
