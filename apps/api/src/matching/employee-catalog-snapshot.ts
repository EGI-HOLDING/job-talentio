import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';

@Injectable()
export class EmployeeCatalogSnapshot {
  constructor(private db: PrismaService, @Optional() private cache?: CandidateCache) {}
  async get() {
    const load = async () => {
      const roles = await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
      return {roles,index:new EmployeeOccupationIndex(roles),revision:createHash('sha256').update(JSON.stringify(roles)).digest('hex')};
    };
    return this.cache ? this.cache.memo('occupation-catalog:' + await this.cache.version('catalog'),600,load) : load();
  }
}
