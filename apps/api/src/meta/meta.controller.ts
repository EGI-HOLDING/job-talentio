import { Controller, Get, Query } from '@nestjs/common';
import { MetaService } from './meta.service';
import { PositionCatalogService } from '../matching/position-catalog.service';
import { RawLocaleNames } from '../common/locale.interceptor';

@Controller('meta')
export class MetaController {
  constructor(private meta: MetaService, private positions: PositionCatalogService) {}

  @Get('skills/suggest')
  suggestSkills(@Query('q') q?: string, @Query('take') take?: string) {
    return this.meta.suggestSkills(q, take ? Number(take) : 10);
  }

  @Get('skills')
  skills(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('sort') sort?: string,
    @Query('take') take?: string,
  ) {
    return this.meta.skills(q, category, sort, take ? Number(take) : 100);
  }

  @Get('countries')
  countries() {
    return this.meta.countries();
  }

  @Get('provinces')
  provinces(@Query('country') country?: string) {
    return this.meta.provinces(country);
  }

  @Get('cities/suggest')
  suggestCities(@Query('q') q?: string, @Query('take') take?: string, @Query('country') country?: string) {
    return this.meta.suggestCities(q, take ? Number(take) : 10, country);
  }

  @Get('cities')
  cities(
    @Query('q') q?: string,
    @Query('province') province?: string,
    @Query('group') group?: string,
    @Query('country') country?: string,
  ) {
    return this.meta.cities(q, province, group, country);
  }

  @Get('platform-stats')
  platformStats() {
    return this.meta.platformStats();
  }

  @Get('categories')
  categories() {
    return this.meta.categories();
  }

  @Get('industries')
  industries(@Query('group') group?: string) {
    return this.meta.industries(group);
  }

  @Get('industry-groups')
  industryGroups() { return this.meta.industryGroups(); }

  @Get('seniority-levels')
  seniorityLevels() { return this.meta.seniorityLevels(); }

  @Get('benefits/suggest')
  suggestBenefits(@Query('q') q?: string, @Query('take') take?: string) {
    return this.meta.suggestBenefits(q, take ? Number(take) : 10);
  }

  @Get('benefits')
  benefits() {
    return this.meta.benefits();
  }

  @Get('languages/suggest')
  suggestLanguages(@Query('q') q?: string, @Query('take') take?: string) {
    return this.meta.suggestLanguages(q, take ? Number(take) : 10);
  }

  @Get('languages')
  languages() {
    return this.meta.languages();
  }

  @Get('job-titles/suggest')
  @RawLocaleNames()
  async suggestJobTitles(@Query('q') q?: string, @Query('take') take?: string) {
    const limit = Math.min(20, Math.max(1, parseInt(take ?? '', 10) || 10));
    const result = await this.positions.search({ q: (q ?? '').slice(0, 160), page: 1, limit, scope: 'directory' });
    return result.items.map(row => ({ ...row, canonicalName: row.name, usageCount: row.count ?? 0 }));
  }

  @Get('job-titles')
  @RawLocaleNames()
  async jobTitles(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(100, Math.max(1, parseInt(limit ?? '', 10) || 24));
    const current = Math.min(100000, Math.max(1, parseInt(page ?? '', 10) || 1));
    const result = await this.positions.search({ q: (q ?? '').slice(0, 160), page: current, limit: take, scope: 'directory' });
    return { ...result, limit: take, items: result.items.map(row => ({
      ...row, canonicalName: row.name, canonicalRoleId: row.id, matchingEligible: row.selectable,
      family: row.family ? { name: row.family } : null,
    })) };
  }
}
