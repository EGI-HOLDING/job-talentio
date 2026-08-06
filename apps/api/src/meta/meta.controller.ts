import { Controller, Get, Query } from '@nestjs/common';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  constructor(private meta: MetaService) {}

  @Get('skills')
  skills(@Query('q') q?: string, @Query('category') category?: string) {
    return this.meta.skills(q, category);
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

  @Get('benefits')
  benefits() {
    return this.meta.benefits();
  }

  @Get('languages')
  languages() {
    return this.meta.languages();
  }
}
