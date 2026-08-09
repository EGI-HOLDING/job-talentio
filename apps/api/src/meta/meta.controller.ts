import { Controller, Get, Query } from '@nestjs/common';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  constructor(private meta: MetaService) {}

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

  @Get('cities/suggest')
  suggestCities(@Query('q') q?: string, @Query('take') take?: string) {
    return this.meta.suggestCities(q, take ? Number(take) : 10);
  }

  @Get('cities')
  cities(@Query('q') q?: string) {
    return this.meta.cities(q);
  }

  @Get('categories')
  categories() {
    return this.meta.categories();
  }

  @Get('industries')
  industries() {
    return this.meta.industries();
  }

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
  suggestJobTitles(@Query('q') q?: string, @Query('take') take?: string) {
    return this.meta.suggestJobTitles(q, take ? Number(take) : 10);
  }

  @Get('job-titles')
  jobTitles(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.meta.jobTitles(q, page ? Number(page) : 1, limit ? Number(limit) : 24);
  }
}
