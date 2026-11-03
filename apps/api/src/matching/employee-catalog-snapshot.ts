import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeOccupationIndex, intentRoleInclude, employeeOccupationRevision, employeeRecommendationRevision } from './employee-occupation';

@Injectable()
export class EmployeeCatalogSnapshot {
  constructor(private db: PrismaService, @Optional() private cache?: CandidateCache) {}
  async get(fresh=false) {
    const load = async () => {
      const roles = await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
      return {roles,index:new EmployeeOccupationIndex(roles),revision:employeeOccupationRevision(roles),recommendationRevision:employeeRecommendationRevision(roles)};
    };
    return this.cache && !fresh ? this.cache.memo('occupation-catalog:' + await this.cache.version('catalog'),600,load) : load();
  }
}
