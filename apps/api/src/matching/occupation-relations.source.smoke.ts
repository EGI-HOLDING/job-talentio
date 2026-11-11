import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildProfessionGraph} from './occupation-relations';
import {loadProfessionSource} from './occupation-relations.service';
import type {IntentRole} from './employee-occupation';
import {professionWorkScopes} from './indonesia-profession-definitions';
const directory=path.resolve(__dirname,'../../prisma/data');
const source=loadProfessionSource();
const official=JSON.parse(fs.readFileSync(path.join(directory,'job-titles/audit-2026-10-24.json'),'utf8').replace(/^\uFEFF/,''));
const families=new Map<string,string>(official.rows.filter((r:any)=>r.source?.uri?.startsWith('http://data.europa.eu/esco/occupation/') && r.source?.isco08).map((r:any)=>[r.source.uri,'isco:'+r.source.isco08.slice(0,3)]));
const roles:IntentRole[]=source.occupations.map(p=>({id:p.uri,name:p.label,familyId:families.get(p.uri)!,canonicalRoleId:null,matchingApproved:true,aliases:[],family:{id:families.get(p.uri)!,name:'Source family',archivedAt:null},matchingMetadata:{sources:[{uri:p.uri}]}}));
const graph=buildProfessionGraph(roles,{...source,workScopes:professionWorkScopes}),byPair=new Map(graph.relations.map(r=>[r.fromRoleId+'|'+r.toRoleId,r])),edges=new Map([...byPair].map(([key,row])=>[key,row.basis.kind])),byName=new Map(source.occupations.map(p=>[p.label.toLowerCase(),p.uri]));
const positives=[['chef','cook'],['accountant','bookkeeper'],['software developer','ICT application developer'],['mechanical engineer','mechanical engineering technician'],['nurse responsible for general care','specialist nurse'],['primary school teacher','early years teacher'],['hairdresser','barber'],['electrician','domestic electrician'],['translator','interpreter'],['digital media designer','graphic designer'],['bus driver','trolley bus driver']];
const pathways=[['chef','restaurant manager'],['graphic designer','illustrator']];
const negatives=[['chef','software developer'],['accountant','cook'],['hairdresser','bus driver'],['software developer','pneumatic engineering technician']];let passed=0;
for(const [from,to]of positives){assert.ok(byName.has(from.toLowerCase())&&byName.has(to.toLowerCase()),'Source occupations exist: '+from+' -> '+to);assert.equal(edges.get(byName.get(from.toLowerCase())+'|'+byName.get(to.toLowerCase())),'RELATED','Relevant work tasks connect '+from+' -> '+to);passed++;}
for(const [from,to]of [...pathways,...negatives]){assert.notEqual(edges.get(byName.get(from)+'|'+byName.get(to)),'RELATED','Unrelated occupations excluded: '+from+' -> '+to);passed++;}
for(const row of graph.relations.filter(r=>r.basis.kind==='RELATED')){
 const reverse=byPair.get(row.toRoleId+'|'+row.fromRoleId);
 assert.equal(row.basis.kind,'RELATED','reciprocal evidence cannot promote a career path without a direct related edge');
 assert.equal(reverse?.basis.kind,'RELATED','a reciprocal relation has the matching reverse edge');
 assert.equal(reverse?.basis.evidenceMode,'SYMMETRIC_ESSENTIAL_TASK_OVERLAP','both directions have identical reciprocal provenance');
 assert.ok(row.basis.sharedEssentialSkillCount>=2,'each direction has direct essential-task evidence');passed++;
}
const familyCount=new Set(positives.map(([from])=>families.get(byName.get(from)!))).size;assert.ok(familyCount>=10);passed++;
console.log(JSON.stringify({suite:'esco-profession-source',passed,families:familyCount,profiles:source.occupations.length,relations:graph.relations.length,related:graph.report.related,reciprocalRelations:graph.report.reciprocalRelations,reciprocalPairs:graph.report.reciprocalPairs,remainingDirectedRelated:graph.report.related-graph.report.reciprocalRelations,crossFamily:graph.report.crossFamily}));
