import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildProfessionGraph,type ProfessionSource} from './occupation-relations';
import type {IntentRole} from './employee-occupation';
const directory=path.resolve(__dirname,'../../prisma/data');
const source=JSON.parse(gunzipSync(fs.readFileSync(path.join(directory,'occupation-profiles/esco-v1.2.1.json.gz'))).toString()) as ProfessionSource;
const official=JSON.parse(fs.readFileSync(path.join(directory,'job-titles/audit-2026-10-24.json'),'utf8').replace(/^\uFEFF/,''));
const families=new Map<string,string>(official.rows.filter((r:any)=>r.source?.uri?.startsWith('http://data.europa.eu/esco/occupation/') && r.source?.isco08).map((r:any)=>[r.source.uri,'isco:'+r.source.isco08.slice(0,3)]));
const roles:IntentRole[]=source.occupations.map(p=>({id:p.uri,name:p.label,familyId:families.get(p.uri)!,canonicalRoleId:null,matchingApproved:true,aliases:[],family:{id:families.get(p.uri)!,name:'Source family',archivedAt:null},matchingMetadata:{sources:[{uri:p.uri}]}}));
const graph=buildProfessionGraph(roles,source),byPair=new Map(graph.relations.map(r=>[r.fromRoleId+'|'+r.toRoleId,r])),edges=new Map([...byPair].map(([key,row])=>[key,row.basis.kind])),byName=new Map(source.occupations.map(p=>[p.label.toLowerCase(),p.uri]));
const positives=[['chef','cook'],['accountant','bookkeeper'],['software developer','ICT application developer'],['mechanical engineer','mechanical engineering technician'],['nurse responsible for general care','specialist nurse'],['primary school teacher','early years teacher'],['hairdresser','barber'],['electrician','domestic electrician'],['translator','interpreter'],['graphic designer','illustrator'],['bus driver','trolley bus driver']];
const pathways=new Set(['chef|restaurant manager','graphic designer|illustrator']);
const negatives=[['chef','software developer'],['accountant','cook'],['hairdresser','bus driver'],['software developer','pneumatic engineering technician']];let passed=0;
for(const [from,to]of positives){assert.ok(byName.has(from.toLowerCase())&&byName.has(to.toLowerCase()),'Source occupations exist: '+from+' -> '+to);assert.equal(edges.get(byName.get(from.toLowerCase())+'|'+byName.get(to.toLowerCase())),pathways.has(from+'|'+to)?'CAREER_PATH':'RELATED','Relevant work tasks connect '+from+' -> '+to);passed++;}
assert.equal(edges.get(byName.get('chef')+'|'+byName.get('restaurant manager')),'CAREER_PATH','Restaurant operations overlap is not direct culinary work');passed++;
for(const [from,to]of negatives){assert.ok(!edges.has(byName.get(from)+'|'+byName.get(to)),'Unrelated occupations excluded: '+from+' -> '+to);passed++;}
for(const row of graph.relations.filter(r=>r.basis.evidenceMode==='SYMMETRIC_ESSENTIAL_TASK_OVERLAP')){
 const reverse=byPair.get(row.toRoleId+'|'+row.fromRoleId);
 assert.equal(row.basis.kind,'RELATED','reciprocal evidence cannot promote a career path without a direct related edge');
 assert.equal(reverse?.basis.kind,'RELATED','a reciprocal relation has the matching reverse edge');
 assert.equal(reverse?.basis.evidenceMode,'SYMMETRIC_ESSENTIAL_TASK_OVERLAP','both directions have identical reciprocal provenance');
 assert.ok((row.basis.reciprocalTaskCount??0)>=2&&row.basis.similarity>=0.3,'reciprocal edges pass the specific-task and symmetric-similarity thresholds');passed++;
}
const familyCount=new Set(positives.map(([from])=>families.get(byName.get(from)!))).size;assert.ok(familyCount>=10);passed++;
console.log(JSON.stringify({suite:'esco-profession-source',passed,families:familyCount,profiles:source.occupations.length,relations:graph.relations.length,related:graph.report.related,reciprocalRelations:graph.report.reciprocalRelations,reciprocalPairs:graph.report.reciprocalPairs,remainingDirectedRelated:graph.report.related-graph.report.reciprocalRelations,crossFamily:graph.report.crossFamily}));
