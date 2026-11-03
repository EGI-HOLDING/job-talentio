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
const graph=buildProfessionGraph(roles,source),edges=new Set(graph.relations.map(r=>r.fromRoleId+'|'+r.toRoleId)),byName=new Map(source.occupations.map(p=>[p.label.toLowerCase(),p.uri]));
const positives=[['chef','cook'],['accountant','bookkeeper'],['software developer','ICT application developer'],['mechanical engineer','mechanical engineering technician'],['nurse responsible for general care','specialist nurse'],['primary school teacher','early years teacher'],['hairdresser','barber'],['electrician','domestic electrician'],['translator','interpreter'],['graphic designer','illustrator'],['bus driver','trolley bus driver']];
const negatives=[['chef','software developer'],['accountant','cook'],['hairdresser','bus driver'],['software developer','pneumatic engineering technician']];let passed=0;
for(const [from,to]of positives){assert.ok(byName.has(from.toLowerCase())&&byName.has(to.toLowerCase()),'Source occupations exist: '+from+' -> '+to);assert.ok(edges.has(byName.get(from.toLowerCase())+'|'+byName.get(to.toLowerCase())),'Relevant work tasks connect '+from+' -> '+to);passed++;}
for(const [from,to]of negatives){assert.ok(!edges.has(byName.get(from)+'|'+byName.get(to)),'Unrelated occupations excluded: '+from+' -> '+to);passed++;}
const familyCount=new Set(positives.map(([from])=>families.get(byName.get(from)!))).size;assert.ok(familyCount>=10);passed++;
console.log(JSON.stringify({suite:'esco-profession-source',passed,families:familyCount,profiles:source.occupations.length,relations:graph.relations.length,crossFamily:graph.report.crossFamily}));
