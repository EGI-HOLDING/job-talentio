const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),h=require(path.join(root,'scripts/lib/hr-demo-env.cjs')),c=h.config({realAuth:true});h.assertDemoUrl(c.databaseUrl);
const {PrismaClient}=h.req('@prisma/client'),db=new PrismaClient({datasources:{db:{url:c.databaseUrl}}});
async function main(){
  const health=[];for(const [name,url]of [['api','http://localhost:4000/api/health'],['web','http://localhost:3000/id/pricing'],['admin','http://localhost:3001']]){const r=await fetch(url);health.push({name,status:r.status});}
  const leftovers=await db.user.findMany({where:{email:{startsWith:'commerce-auth-',endsWith:'@example.invalid'},createdAt:{gte:new Date('2026-10-28T02:52:52Z')}},select:{id:true,createdAt:true,memberships:{select:{companyId:true,company:{select:{name:true,_count:{select:{jobPosts:true,members:true}}}}}}}});
  console.log(JSON.stringify({health,fixtureUsers:leftovers},null,2));
  if(process.argv.includes('--clean-owned-orphan')){
    assert.equal(leftovers.length,1,'Only the single known failed-registration fixture may be removed');const row=leftovers[0];assert.equal(row.memberships.length,1);const m=row.memberships[0];assert.match(m.company.name,/^Password Flow Company [a-f0-9-]{36}$/);assert.equal(m.company._count.jobPosts,0);assert.equal(m.company._count.members,1);
    await db.company.delete({where:{id:m.companyId}});await db.user.delete({where:{id:row.id}});console.log('Removed verified orphan from first failed browser-response capture.');
  }
  const fixtureCompanies=await db.company.count({where:{OR:['commerce-browser-','commerce-edge-','package-features-','preference-visual-'].map(prefix=>({slug:{startsWith:prefix}}))}});
  const temporaryDatabases=await db.$queryRawUnsafe("SELECT datname FROM pg_database WHERE datname LIKE 'talentio_hr_it_%'");
  console.log(JSON.stringify({fixtureCompanies,temporaryDatabases},null,2));
  fs.writeFileSync(path.join(__dirname,'runtime-inspection.json'),JSON.stringify({at:new Date().toISOString(),health,fixtureUsers:leftovers.map(row=>({id:row.id,createdAt:row.createdAt})),fixtureCompanies,temporaryDatabases},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
