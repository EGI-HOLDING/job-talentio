import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JobsSearchService } from './jobs-search.service';

/** Global so JobsService and AdminService can sync without import cycles. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [JobsSearchService],
  exports: [JobsSearchService],
})
export class SearchModule {}
