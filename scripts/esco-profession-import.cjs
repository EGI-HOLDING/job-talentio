// Public ESCO data only. Resume safely from normalized per-concept cache files.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),version='v1.2.1';
const cache=path.join(root,'output/esco-professions',version),destination=path.join(root,'apps/api/prisma/data/occupation-profiles');
fs.mkdirSync(cache,{recursive:true});
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function request(endpoint,params){
 const url=new URL('https://ec.europa.eu/esco/api/'+endpoint);for(const [k,v] of Object.entries({...params,language:'en',selectedVersion:version}))url.searchParams.set(k,v);
 for(let attempt=0;attempt<4;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('ESCO HTTP '+r.status);return await r.json();}catch(e){if(attempt===3)throw e;await new Promise(r=>setTimeout(r,1000*2**attempt));}}
}
async function pool(rows,fn){let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<rows.length){const n=cursor++;await fn(rows[n],n);}}));}
async function main(){
 const official=JSON.parse(fs.readFileSync(path.join(root,'apps/api/prisma/data/job-titles/audit-2026-10-24.json'),'utf8').replace(/^\uFEFF/,''));
 const uris=[...new Set(official.rows.map(r=>r.source?.uri).filter(uri=>uri?.startsWith('http://data.europa.eu/esco/occupation/')))].sort();
 const file=uri=>path.join(cache,uri.split('/').pop()+'.json');
 const pending=uris.filter(uri=>!fs.existsSync(file(uri))),batches=[];for(let i=0;i<pending.length;i+=25)batches.push(pending.slice(i,i+25));
 await pool(batches,async(batch,n)=>{const d=await request('resource/occupation',{uris:batch.join(',')});for(const uri of batch){const p=d._embedded?.[uri];if(!p||p.uri!==uri)throw Error('Missing occupation '+uri);const links=p._links||{},skills=(kind)=> (links[kind]||[]).map(s=>({uri:s.uri,label:s.title}));const row={uri,label:p.preferredLabel?.en||p.title,aliases:p.alternativeLabel?.en||[],description:p.description?.en?.literal||'',scopeNote:p.scopeNote?.en?.literal||'',code:p.code||'',essential:skills('hasEssentialSkill'),optional:skills('hasOptionalSkill')};fs.writeFileSync(file(uri),JSON.stringify(row));}console.log('ESCO occupations '+Math.min((n+1)*25,pending.length)+'/'+pending.length);});
 const skills=[];const initial=await request('search',{type:'skill',limit:1000,offset:0});const pages=Array.from({length:Math.ceil(initial.total/1000)},(_,i)=>i);
 await pool(pages,async page=>{const f=path.join(cache,'skills-types-page-'+page+'.json');let d;if(fs.existsSync(f))d=JSON.parse(fs.readFileSync(f,'utf8'));else{const raw=page?await request('search',{type:'skill',limit:1000,offset:page}):initial;d=(raw._embedded?.results||[]).map(s=>({uri:s.uri,label:s.preferredLabel?.en||s.title,reuse:(s.hasReuseLevel?.[0]||'').split('/').pop(),type:(s.hasSkillType?.[0]||'').split('/').pop()}));fs.writeFileSync(f,JSON.stringify(d));}skills.push(...d);});
 const occupations=uris.map(uri=>JSON.parse(fs.readFileSync(file(uri),'utf8'))),sortedSkills=skills.sort((a,b)=>a.uri.localeCompare(b.uri));
 if(occupations.length!==official.sourceCount||new Set(sortedSkills.map(s=>s.uri)).size!==initial.total)throw Error('Incomplete source snapshot');
 const payload={source:'European Commission ESCO',sourceVersion:version,sourceUrl:'https://esco.ec.europa.eu/en/use-esco',method:'Official version-pinned API; profession relations are derived by Talentio',occupations,skills:sortedSkills};
 fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'esco-v1.2.1.json.gz'),zlib.gzipSync(JSON.stringify(payload),{level:9}));
 const manifest={source:payload.source,sourceVersion:version,sourceUrl:payload.sourceUrl,occupations:occupations.length,skills:skills.length,sha256:hash(payload),importedAt:new Date().toISOString()};fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
}
main().catch(e=>{console.error(e);process.exitCode=1});
