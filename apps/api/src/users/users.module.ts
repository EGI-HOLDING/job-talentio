import { Module } from '@nestjs/common';
import { UserErasureService } from './user-erasure.service';

@Module({
  providers: [UserErasureService],
  exports: [UserErasureService],
})
export class UsersModule {}
