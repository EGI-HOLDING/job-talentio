import fs from 'node:fs';
const d='output/research/job-titles-audit-2026-10-24/';
const dict=new Map(fs.readFileSync(d+'commodity-lexicon.tsv','utf8').split(/\r?\n/).filter(l=>l.includes('|')).map(l=>{const [en,id,uz]=l.split('|');return [en,[id,uz]];}));
const templates=[
[/^(.+) distribution manager$/, (id,uz)=>[`Manajer distribusi ${id}`,`${uz} distribusiyasi menejeri`]],
[/^import export manager in (.+)$/, (id,uz)=>[`Manajer impor ekspor ${id}`,`${uz} import-eksport menejeri`]],
[/^import export specialist in (.+)$/, (id,uz)=>[`Spesialis impor ekspor ${id}`,`${uz} import-eksport mutaxassisi`]],
[/^wholesale merchant in (.+)$/, (id,uz)=>[`Pedagang grosir ${id}`,`${uz} ulgurji savdogari`]],
[/^technical sales representative in (.+)$/, (id,uz)=>[`Perwakilan penjualan teknis ${id}`,`${uz} texnik savdo vakili`]],
];
const out=[];
for(const group of ['1','2','3']) {
 const lines=fs.readFileSync(d+`missing-${group}.txt`,'utf8').split(/\r?\n/).filter(Boolean), remaining=[];
 for(const line of lines){const [,code,en]=line.split('|');let pair;for(const [rx,fn]of templates){const m=en.match(rx);if(m&&dict.has(m[1])){pair=fn(...dict.get(m[1]));break;}}
 if(pair)out.push(`${code}|${pair[0]}|${pair[1][0].toLocaleUpperCase('uz')+pair[1].slice(1)}`);else remaining.push(line);
 }
 fs.writeFileSync(d+`manual-${group}.txt`,remaining.join('\n')+'\n');
}
fs.writeFileSync(d+'labels-commodity.tsv',out.join('\n')+'\n');console.log({templated:out.length});
