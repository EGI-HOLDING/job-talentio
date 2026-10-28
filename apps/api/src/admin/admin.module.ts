import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminListsService } from './admin-lists.service';
import { AdminBulkService } from './admin-bulk.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminUsersService } from './admin-users.service';
import { AdminVerificationService } from './admin-verification.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [AuthModule, UsersModule, NotificationsModule, JobsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminListsService,
    AdminBulkService,
    AdminCatalogService,
    AdminUsersService,
    AdminVerificationService,
  ],
})
export class AdminModule {}
