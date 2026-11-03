import 'reflect-metadata';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { of, firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { CandidateCache } from './candidate-cache';

async function main(){
 const cache=new CandidateCache(new ConfigService({DATABASE_URL:'local-cache-unit-fixture',REDIS_URL:'redis://127.0.0.1:1'}));
 const storage=new Map<string,string>();
 (cache as any).redis.disconnect();
 (cache as any).redis={status:'ready',get:async(key:string)=>storage.get(key)||null,set:async(key:string,value:string)=>{storage.set(key,value);},incr:async(key:string)=>{const n=Number(storage.get(key)||0)+1;storage.set(key,String(n));return n;},disconnect:()=>{}};
 try{
  let loads=0;const load=async()=>{loads++;return [{id:'one',publishedAt:new Date('2026-01-01')}];};
  await Promise.all([cache.ranked(['profile-a','cv-1'],load),cache.ranked(['profile-a','cv-1'],load)]);assert.equal(loads,1);
  await cache.ranked(['profile-a','cv-2'],load);assert.equal(loads,2);
  await cache.invalidate();await cache.ranked(['profile-a','cv-1'],load);assert.equal(loads,3);
  let catalogLoads=0;await cache.memo('occupation-catalog:0',600,async()=>++catalogLoads);await cache.invalidate();await cache.memo('occupation-catalog:0',600,async()=>++catalogLoads);assert.equal(catalogLoads,1);
  await cache.invalidate(true);await cache.memo('occupation-catalog:1',600,async()=>++catalogLoads);assert.equal(catalogLoads,2);
  const response=new EventEmitter();let shadows=0,release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  await firstValueFrom(cache.inRequest(response as any,()=>{cache.shadow('one',async()=>{shadows++;await waiting;});cache.shadow('two',async()=>{shadows++;await waiting;});cache.shadow('three',async()=>{shadows++;});return of('response');}));
  assert.equal(shadows,0);response.emit('finish');await new Promise(resolve=>setImmediate(resolve));assert.equal(shadows,2);
  cache.shadow('one',async()=>{shadows++;});assert.equal(shadows,2);release();
  console.log('PASS: ranking deduplication, revision keys, write/catalog invalidation, shadow after HTTP finish, and at most two shadow tasks.');
 }finally{cache.onModuleDestroy();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
