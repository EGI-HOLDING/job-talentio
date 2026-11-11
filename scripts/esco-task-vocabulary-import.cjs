// Offline build input only. Downloads public ESCO records, never job/CV data.
const fs=require('node:fs'), path=require('node:path'), zlib=require('node:zlib'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), dir=path.join(root,'apps/api/prisma/data/occupation-profiles');
const cache=path.join(root,'output/esco-task-vocabulary/v1.2.1');
const version='v1.2.1', endpoint='https://ec.europa.eu/esco/api/resource/skill';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fetchBatch(uris){
  const url=new URL(endpoint); for(const [key,value] of Object.entries({uris:uris.join(','),language:'en',selectedVersion:version}))url.searchParams.set(key,value);
  for(let attempt=0;;attempt++){
    try {
      const res=await fetch(url,{signal:AbortSignal.timeout(60_000)});
      if(!res.ok)throw Error('ESCO HTTP '+res.status);
      const data=await res.json();
      return uris.map(uri=>{
        const row=data._embedded?.[uri];if(row?.uri!==uri)throw Error('Missing ESCO skill '+uri);
        return {uri,label:row.preferredLabel?.en||row.title,aliases:[...new Set(row.alternativeLabel?.en||[])].sort(),description:row.description?.en?.literal||'',
          broader:[...new Set((row._links?.broaderHierarchyConcept||[]).map(x=>x.uri).filter(Boolean))].sort(),
          groups:[...new Set((row._links?.isInScheme||[]).map(x=>x.uri).filter(Boolean))].sort()};
      });
    }catch(error){if(attempt>=4)throw error;await new Promise(resolve=>setTimeout(resolve,750*2**attempt));}
  }
}
async function main(){
  const snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,'esco-v1.2.1.json.gz'))));
  if(snapshot.sourceVersion!==version)throw Error('Wrong base snapshot');
  fs.mkdirSync(cache,{recursive:true});
  const uris=snapshot.skills.map(x=>x.uri).sort(), batches=[];
  for(let i=0;i<uris.length;i+=50)batches.push(uris.slice(i,i+50));
  const rows=[]; let cursor=0,done=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<batches.length){
    const batch=batches[cursor++], filename=path.join(cache,digest(batch)+'.json');
    const records=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename)):await fetchBatch(batch);
    if(records.length!==batch.length||records.some((row,i)=>row.uri!==batch[i]))throw Error('Invalid cached ESCO batch');
    if(!fs.existsSync(filename))fs.writeFileSync(filename,JSON.stringify(records));
    rows.push(...records);done++;if(done%20===0||done===batches.length)console.log('ESCO vocabulary batches '+done+'/'+batches.length);
  }}));
  rows.sort((a,b)=>a.uri.localeCompare(b.uri));
  if(new Set(rows.map(row=>row.uri)).size!==uris.length)throw Error('Incomplete ESCO skill vocabulary');
  const payload={sourceVersion:version,source:endpoint,skills:rows};
  const manifest={sourceVersion:version,source:endpoint,skills:rows.length,sha256:digest(payload)};
  fs.writeFileSync(path.join(dir,'esco-task-vocabulary-v1.2.1.json.gz'),zlib.gzipSync(JSON.stringify(payload),{level:9}));
  fs.writeFileSync(path.join(dir,'task-vocabulary-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest));
}
void main().catch(error=>{console.error(error.message);process.exitCode=1});
