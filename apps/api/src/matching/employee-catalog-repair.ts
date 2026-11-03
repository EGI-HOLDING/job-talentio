import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { catalogTitleIdentityKey as key } from '../common/title-resolve';
import { EmployeeOccupationIndex, intentRoleInclude, type IntentRole } from './employee-occupation';
import { approvedOccupationAliases, curatedPositionLabels, CURATION_SOURCE, EMPLOYEE_CATALOG_CURATION_VERSION as VERSION, nonProductionOccupationNames, occupationDefinitionRequired, occupationFamilyDecisions, rejectedOccupationAliases } from './employee-catalog-curation';

export const catalogDigest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Role = IntentRole & { slug?: string; normalizedKey?: string; matchingMetadata?: unknown };
export type OfficialRole = { targetId: string; name: string; source?: { isco08?: string; uri?: string } };
export const curatedEquivalences: Record<string,string> = {
 'Pramusaji Restoran':'Waiter/waitress', 'Pramusaji Senior':'Waiter/waitress',
 'Kasir Restoran':'Cashier', 'Kasir dan Pengendali Transaksi':'Cashier', 'Kasir Senior dan Pengendali Transaksi':'Cashier',
 'Barista Outlet':'Barista', 'Barista Senior':'Barista',
 'Koki Senior Dapur Dingin':'Koki Dapur Dingin',
 'Teknisi Senior Pemeliharaan':'Teknisi Pemeliharaan',
};
const renamedOfficialLabels: Record<string,string[]> = {
 'Data Entry Clerk':['Data Clerk'], 'Data Entry Supervisor':['Data Supervisor'],
 'Further Education Principal':['Further Education'], 'Middle Office Analyst':['Office Analyst'],
};
export type CatalogRepairPlan = ReturnType<typeof planCatalogRepair>;
export function planCatalogRepair(input: { roles: Role[]; families: Array<{id:string;archivedAt?:Date|null}>; official:OfficialRole[] }) {
 const roles = structuredClone(input.roles).sort((a,b)=>a.id.localeCompare(b.id)), families = new Set(input.families.filter(f=>!f.archivedAt).map(f=>f.id));
 for(const role of roles)role.aliases.sort((a,b)=>a.alias.localeCompare(b.alias));
 const updates: Array<{id:string;expectedName:string;name?:string;familyId?:string;canonicalRoleId?:string|null;matchingApproved:boolean;reason:string;archive?:boolean}> = [];
 const creates: Array<{id:string;name:string;nameId:string;slug:string;normalizedKey:string;familyId:string;matchingApproved:true}> = [];
 const errors: string[] = [], pending: Array<{id:string;name:string;reason:string}> = [];
 const byName = (name:string) => roles.filter(r=>!r.archivedAt&&key(r.name)===key(name));
 const familyFor = (code:string) => {const id='isco:'+code;if(!families.has(id))errors.push('Missing active family '+id);return id;};
 const update = (role:Role,data:Omit<(typeof updates)[number],'id'|'expectedName'>) => {
   const previous=updates.find(r=>r.id===role.id);
   if(previous)Object.assign(previous,data);else updates.push({id:role.id,expectedName:role.name,...data});
   Object.assign(role,data);if(data.archive)role.archivedAt=new Date(0);
 };
 const quarantines=new Map([...nonProductionOccupationNames.map(n=>[key(n),'Repository smoke-test occupation'] as const),...Object.entries(occupationDefinitionRequired).map(([n,reason])=>[key(n),reason] as const)]);
 for(const role of roles.filter(r=>!r.archivedAt)){
   const reason=quarantines.get(key(role.name));
   if(reason){update(role,{matchingApproved:false,archive:true,reason});pending.push({id:role.id,name:role.name,reason});}
 }
 // Match official IDs and explicitly accepted former labels; never infer from a
 // similar title, seniority stripping or a common family.
 for(const s of input.official){
   const role=roles.find(r=>r.id===s.targetId);if(!role||role.archivedAt)continue;
   if(!s.source?.isco08||!s.source.uri?.startsWith('http://data.europa.eu/esco/occupation/'))continue;
   const names=[s.name,...(renamedOfficialLabels[s.name]||[])];
   if(!names.some(n=>key(n)===key(role.name))){errors.push('Official label needs review: '+role.id+' '+role.name);continue;}
   const familyId=familyFor(s.source.isco08.slice(0,3));
   if(role.familyId&&role.familyId!==familyId){errors.push('Official family conflict: '+role.name);continue;}
   if(!role.matchingApproved||role.familyId!==familyId||role.name!==s.name)
     update(role,{name:s.name,familyId,canonicalRoleId:role.canonicalRoleId,matchingApproved:true,reason:'Verified ESCO ID, code and accepted label: '+s.source.uri});
 }
 const namesSeen=new Set<string>();
 for(const [code,definition,names] of occupationFamilyDecisions){
   const familyId=familyFor(code);
   for(const name of names.split('|')){
     if(namesSeen.has(key(name))){errors.push('Duplicate editorial decision: '+name);continue;}namesSeen.add(key(name));
     const matches=byName(name);if(matches.length>1){errors.push('Ambiguous existing position: '+name);continue;}
     const role=matches[0];
     if(role){
       if(role.matchingApproved&&role.familyId&&role.familyId!==familyId){errors.push('Editorial/approved family conflict: '+name+' '+role.familyId+' vs '+familyId);continue;}
       if(!role.matchingApproved||role.familyId!==familyId)update(role,{familyId,matchingApproved:true,reason:definition});
     }else{
       const normalizedKey=key(name),id='curated_'+catalogDigest(normalizedKey).slice(0,32);
       if(roles.some(r=>r.id===id||r.slug===normalizedKey||r.normalizedKey===normalizedKey)){errors.push('Position key collision: '+name);continue;}
       const nameId=curatedPositionLabels[name]||name;
       creates.push({id,name,nameId,slug:normalizedKey,normalizedKey,familyId,matchingApproved:true});
       roles.push({id,name,nameId,familyId,canonicalRoleId:null,matchingApproved:true,aliases:[],family:{id:familyId,name:familyId,archivedAt:null}});
     }
   }
 }
 // Populate the projected family relation for newly approved existing roles.
 for(const role of roles)if(role.familyId&&families.has(role.familyId))role.family={id:role.familyId,name:role.family?.name||role.familyId,archivedAt:null};
 for(const [name,target] of Object.entries(curatedEquivalences)){
   const children=byName(name), roots=byName(target);
   if(children.length!==1||roots.length!==1){errors.push('Equivalence needs unique positions: '+name+' -> '+target);continue;}
   const child=children[0],root=roots[0];
   if(root.canonicalRoleId||child.familyId!==root.familyId||!root.matchingApproved){errors.push('Invalid equivalence: '+name);continue;}
   if(child.id!==root.id&&child.canonicalRoleId!==root.id)update(child,{canonicalRoleId:root.id,matchingApproved:true,reason:'Curated translation/seniority equivalence to '+root.name});
 }
 const index=new EmployeeOccupationIndex(roles);
 const labels=new Map<string,Set<string>>();
 for(const role of roles.filter(r=>!r.archivedAt))for(const label of [role.name,role.nameId,role.nameUz,role.nameRu].filter((s):s is string=>!!s)){
   const labelKey=key(label),ids=labels.get(labelKey)||new Set<string>();ids.add(role.id);labels.set(labelKey,ids);
 }
 const aliasDecisions: Array<{roleId:string;alias:string;aliasKey:string;approved:boolean;reason:string}> = [];
 for(const role of roles.filter(r=>!r.archivedAt&&index.identity(r.id))){
   const own=new Set([role.name,role.nameId,role.nameUz,role.nameRu].filter((s):s is string=>!!s).map(key));
   const allow=new Set((approvedOccupationAliases[role.name]||[]).map(key));
   const extras=approvedOccupationAliases[role.name]||[];
   const aliases=[...role.aliases,...extras.filter(a=>!role.aliases.some(b=>key(b.alias)===key(a))).map(alias=>({alias,matchingApproved:false}))];
   for(const alias of aliases){
     const aliasKey=key(alias.alias),rejected=Object.entries(rejectedOccupationAliases).find(([a])=>key(a)===aliasKey)?.[1];
     let approved=!rejected&&(own.has(aliasKey)||allow.has(aliasKey));
     const collisions=[...(labels.get(aliasKey)||[])].some(id=>index.identity(id)?.canonicalRoleId!==index.identity(role.id)?.canonicalRoleId);
     if(collisions)approved=false;
     if(approved) {const ids=labels.get(aliasKey)||new Set<string>();ids.add(role.id);labels.set(aliasKey,ids);}
     aliasDecisions.push({roleId:role.id,alias:alias.alias,aliasKey,approved,reason:rejected|| (collisions?'Conflicting identity label':approved?'Reviewed multilingual label or explicit equivalence':'Additional equivalence review required')});
   }
 }
 // Only reviewed aliases enter the projected resolver.
 for(const role of roles)role.aliases=aliasDecisions.filter(a=>a.roleId===role.id).map(a=>({alias:a.alias,matchingApproved:a.approved}));
 const finalIndex=new EmployeeOccupationIndex(roles);
 const unknown=roles.filter(r=>!r.archivedAt&&!finalIndex.identity(r.id)).map(r=>({id:r.id,name:r.name,reason:'No verified family decision'}));
 for(const role of roles.filter(r=>!r.archivedAt&&finalIndex.identity(r.id))){
   const resolved=finalIndex.resolve(role.name);
   if(!resolved||resolved!==finalIndex.identity(role.id)?.canonicalRoleId)errors.push('Position label does not resolve uniquely: '+role.name);
 }
 const payload={version:VERSION,creates,updates,aliasDecisions,pending,unknown,errors};
 return {...payload,hash:catalogDigest(payload),roles,index:finalIndex};
}

export async function applyCatalogRepair(tx: Prisma.TransactionClient,plan:CatalogRepairPlan) {
 if(plan.errors.length)throw new Error(plan.errors.join('\n'));
 const receipt={provider:'Talentio task-based family curation',version:VERSION,uri:CURATION_SOURCE};
 for(const create of plan.creates)await tx.jobTitle.create({data:{...create,matchingMetadata:{sources:[receipt],relatedRoles:[]}}});
 for(const change of plan.updates){
   const {id,expectedName,reason,archive,...data}=change;
   const before=await tx.jobTitle.findUniqueOrThrow({where:{id}});
   if(before.name!==expectedName)throw new Error('Position changed during repair: '+id);
   const metadata=before.matchingMetadata&&typeof before.matchingMetadata==='object'&&!Array.isArray(before.matchingMetadata)?before.matchingMetadata:{};
   const sources=Array.isArray(metadata.sources)?metadata.sources:[];
   const reviewedSources=sources.some(s=>s&&typeof s==='object'&&!Array.isArray(s)&&s.provider===receipt.provider&&s.version===VERSION)?sources:[...sources,receipt];
   await tx.jobTitle.update({where:{id},data:{...data,...(archive?{archivedAt:new Date()}:{}),matchingMetadata:{...metadata,sources:reviewedSources.slice(-10),relatedRoles:metadata.relatedRoles||[]} as Prisma.InputJsonValue}});
 }
 let aliasChanges=0;
 const storedAliases=await tx.jobTitleAlias.findMany();
 const byAlias=new Map(storedAliases.map(a=>[a.jobTitleId+'\0'+a.alias,a]));
 const byKey=new Map(storedAliases.map(a=>[a.aliasKey,a]));
 const approve:string[]=[],reject:string[]=[],newAliases:Array<{jobTitleId:string;alias:string;aliasKey:string;matchingApproved:true}>=[];
 for(const a of plan.aliasDecisions){
   const stored=byAlias.get(a.roleId+'\0'+a.alias);
   if(stored){if(stored.matchingApproved!==a.approved)(a.approved?approve:reject).push(stored.id);}
   else if(a.approved){
     const collision=byKey.get(a.aliasKey);
     if(collision){if(collision.jobTitleId!==a.roleId)throw new Error('Alias ownership conflict: '+a.alias);continue;}
     if(!newAliases.some(row=>row.aliasKey===a.aliasKey))newAliases.push({jobTitleId:a.roleId,alias:a.alias,aliasKey:a.aliasKey,matchingApproved:true});
   }
 }
 if(approve.length)aliasChanges+=(await tx.jobTitleAlias.updateMany({where:{id:{in:approve}},data:{matchingApproved:true}})).count;
 if(reject.length)aliasChanges+=(await tx.jobTitleAlias.updateMany({where:{id:{in:reject}},data:{matchingApproved:false}})).count;
 if(newAliases.length)aliasChanges+=(await tx.jobTitleAlias.createMany({data:newAliases})).count;
 return {positionsCreated:plan.creates.length,positionsChanged:plan.updates.length,aliasChanges};
}

export async function readCatalogRepairInput(db:Pick<Prisma.TransactionClient,'jobTitle'|'jobFamily'>,official:OfficialRole[]) {
 const [roles,families]=await Promise.all([db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}}),db.jobFamily.findMany()]);
 return {roles,families,official};
}
