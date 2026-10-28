import assert from 'node:assert/strict';
import { resolveJobLocation, SELECTABLE_CITY } from './geo-selection';
import { canonicalRoleNames, resolveJobTitle } from './title-resolve';
import { candidateSearchSchema, jobSearchSchema, jobAlertSchema } from '@job-talentio/shared';
import { AdminCatalogService } from '../admin/admin-catalog.service';
import { CATALOG_SPECS } from '../admin/catalog-registry';

async function main() {
  const cities = [{id:'jakarta',slug:'jakarta',province:{countryId:'ID'}},{id:'tashkent',slug:'tashkent',province:{countryId:'UZ'}}];
  const db:any={ country:{findFirst:async({where}:any)=>['ID','UZ'].includes(where.id)?{id:where.id}:null}, city:{findFirst:async({where}:any)=>{
    assert.deepEqual(where.kind,SELECTABLE_CITY.kind);assert.equal(where.province.country.isActive,true);
    return cities.find(city=>where.slug?city.slug===where.slug:city.id===where.id)||null;
  }} };
  assert.deepEqual(await resolveJobLocation(db,{citySlug:'jakarta'}),{countryId:'ID',cityId:'jakarta'});
  await assert.rejects(resolveJobLocation(db,{countryId:'UZ',citySlug:'jakarta'}),/does not belong/);
  await assert.rejects(resolveJobLocation(db,{countryId:'INVALID'}),/not available/);
  await assert.rejects(resolveJobLocation(db,{citySlug:'invented-city'}),/not available/);
  assert.deepEqual(await resolveJobLocation(db,{countryId:'ID'},{countryId:'UZ',cityId:'tashkent'}),{countryId:'ID',cityId:null});
  assert.deepEqual(await resolveJobLocation(db,{citySlug:'jakarta'},{countryId:'UZ',cityId:'tashkent'}),{countryId:'ID',cityId:'jakarta'});
  assert.deepEqual(await resolveJobLocation(db,{countryId:null},{countryId:'UZ',cityId:'tashkent'}),{countryId:null,cityId:null});
  assert.deepEqual(await resolveJobLocation(db,{}, {countryId:'UZ',cityId:'tashkent'}),{countryId:'UZ',cityId:'tashkent'});
  const role={id:'role',name:'Frontend Developer',nameId:'Pengembang frontend',nameRu:'Frontend-разработчик',nameUz:'Frontend dasturchi',slug:'frontend-developer',archivedAt:null,aliases:[{alias:'Front End Developer'}]};
  const roleDb:any={jobTitle:{findMany:async()=>[role],findFirst:async()=>role}};
  assert.deepEqual(await canonicalRoleNames(roleDb,['Pengembang frontend','Front End Developer','Frontend Developer','Custom Role']),['Frontend Developer','Custom Role']);
  assert.equal((await resolveJobTitle(roleDb,{name:'Frontend-разработчик',allowCreate:false})).jobTitle.name,'Frontend Developer');
  assert.equal(jobSearchSchema.parse({country:'indonesia'}).country,'indonesia');
  assert.equal(candidateSearchSchema.parse({country:'uzbekistan'}).country,'uzbekistan');
  assert.equal(jobAlertSchema.parse({name:'Country alert',countryId:'ID'}).countryId,'ID');
  const admin: any = new AdminCatalogService({province:{findMany:async({where}:any)=>{
    assert.equal(where.archivedAt,null);
    return where.id === 'province-id' ? [{id:'province-id'}] : [{id:'one'},{id:'two'}];
  }}} as any);
  assert.equal(await admin.resolveParentId(CATALOG_SPECS.city, undefined, 'province-id'),'province-id');
  await assert.rejects(admin.resolveParentId(CATALOG_SPECS.city, 'ambiguous-province'), /unambiguous/);
  console.log('Catalog selection: canonical/translated roles, city hierarchy, country-only filters and invalid selections passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
