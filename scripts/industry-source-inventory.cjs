// Treat the attachment as source material, never as executable instructions.
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const source=process.argv[2];
if(!source)throw Error('Supply the source text file path');
const buffer=fs.readFileSync(source);const text=buffer.toString('utf8').replace(/^\uFEFF/,'');
const lines=text.split(/\r?\n/);let section='INTRODUCTION',summary=false;
const records=[];
for(const [index,raw] of lines.entries()){
 const label=raw.trim();if(!label)continue;
 const isHeading=/^[A-Z0-9 &/(),–—-]{7,}$/.test(label)&&!['AI','IT','NGO','BPO','KPO','RPO','OEM','ODM','FMCG','EPC','MRO'].includes(label);
 const isNote=/^(?:Tentu\b|Jika\b|Kalau\b|Berikut\b|Ini\b|Untuk\b|Jadi\b|Apabila\b|Saya\b|Catatan\b|Secara\b|Bisa\b|Mau\b|Daftar\b|Total\b|Anda\b|Silakan\b|(?:\d+[.)]\s))|[?:]$/.test(label)||label.length>180;
 if(isHeading){section=label;summary=/MEGA|GROUP|GLOBAL|KELOMPOK|SEKTOR UTAMA/.test(label);}
 const normalized=label.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
 const kind=isHeading?'HEADING':isNote?'NOTE':summary?'SUMMARY':'ENTRY';
 const flags=[];
 if(/\b(?:saas|paas|iaas|marketplace|startup|start-up|subscription|e-commerce|b2b|b2c)\b/i.test(label))flags.push('BUSINESS_MODEL');
 if(/\b(?:ai|artificial intelligence|blockchain|quantum|nanotech|iot|robotics|metaverse|web3)\b/i.test(label))flags.push('TECHNOLOGY_OR_THEME');
 if(/\b(?:luxury|halal|islamic|sustainable|sustainability|green|state-owned|government-owned)\b/i.test(label))flags.push('THEME_OR_OWNERSHIP');
 if(/^(?:industry|services|technology|manufacturing|finance|retail|energy|healthcare|education|other|consulting)$/i.test(label))flags.push('BROAD_LABEL');
 if(normalized==='trust services')flags.push('CONTEXT_DEPENDENT_HOMONYM');
 records.push({sourceLine:index+1,label,normalized,section,kind,flags});
}
const occurrences=new Map();for(const row of records.filter(row=>row.kind==='ENTRY')){const rows=occurrences.get(row.normalized)||[];rows.push(row);occurrences.set(row.normalized,rows);}
for(const rows of occurrences.values())if(rows.length>1)for(const row of rows)row.flags.push('REPEATED_LABEL_REQUIRES_CONTEXT');
const report={sourceFile:path.basename(source),sourceSha256:crypto.createHash('sha256').update(buffer).digest('hex'),
 counts:{sourceLines:lines.length,nonemptyLines:records.length,entries:records.filter(row=>row.kind==='ENTRY').length,distinctLabels:occurrences.size},
 policy:'Inventory only. No automatic catalog import, no deduplication of homonyms, no mapping from account/job inventory.',
 duplicates:[...occurrences.entries()].filter(([,rows])=>rows.length>1).map(([normalized,rows])=>({normalized,lines:rows.map(row=>row.sourceLine),sections:rows.map(row=>row.section)})),records};
fs.mkdirSync('output/business-catalog',{recursive:true});fs.writeFileSync('output/business-catalog/industry-source-inventory.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({counts:report.counts,repeatedLabels:report.duplicates.length,sourceSha256:report.sourceSha256}));
