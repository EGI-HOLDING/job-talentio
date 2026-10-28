import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { EmployeeMatchingService } from './employee-matching.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [MatchingService, EmployeeMatchingService],
  exports: [MatchingService, EmployeeMatchingService],
})
export class MatchingModule {}
