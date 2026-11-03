import { CallHandler, ExecutionContext, Global, Injectable, Module, NestInterceptor, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { invalidateHrRanking } from '../matching/recruiter-ranking.service';
import { mergeMap } from 'rxjs/operators';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class CandidateCache implements OnModuleDestroy {
  private redis: Redis;
  private namespace: string;
  private localEpoch = 0;
  private memory = new Map<string, { expires: number; value: Promise<unknown> }>();
  private shadowRuns = new Map<string, number>();
  private running = 0;
  private deferred = new AsyncLocalStorage<Array<{launch:()=>void;cancel:()=>void}>>();
  constructor(config: ConfigService) {
    this.namespace = 'candidate-perf-v1:' + hash(config.get('DATABASE_URL', '')).slice(0, 16);
    this.redis = new Redis(config.get('REDIS_URL', 'redis://localhost:6379'), { lazyConnect: true, connectTimeout: 1000, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', () => {}); void this.redis.connect().catch(() => {});
  }
  async version(kind: 'catalog' | 'jobs') {
    try { if (this.redis.status === 'ready') return await this.redis.get(`${this.namespace}:epoch:${kind}`) || '0'; } catch {}
    return 'fallback:' + this.localEpoch;
  }
  async invalidate(catalog = false) {
    this.localEpoch++;
    for(const key of this.memory.keys())if(catalog||!key.startsWith('occupation-catalog:')&&!key.startsWith('legacy-occupation:'))this.memory.delete(key);
    this.shadowRuns.clear();
    try { if (this.redis.status === 'ready') { await this.redis.incr(`${this.namespace}:epoch:jobs`); if (catalog) await this.redis.incr(`${this.namespace}:epoch:catalog`); } } catch {}
  }
  async invalidateAndWait(catalog=false){
    if(this.redis.status!=='ready')await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);this.redis.off('ready',done);resolve();};
      const timer=setTimeout(done,1500);this.redis.once('ready',done);
    });
    await this.invalidate(catalog);
  }
  memo<T>(key: string, seconds: number, load: () => Promise<T>): Promise<T> {
    const existing = this.memory.get(key);
    if (existing && existing.expires > Date.now()) return existing.value as Promise<T>;
    const value = Promise.resolve().then(load).catch(error => { this.memory.delete(key); throw error; });
    this.memory.set(key, { expires: Date.now() + seconds * 1000, value });
    while (this.memory.size > 64) this.memory.delete(this.memory.keys().next().value!);
    return value;
  }
  async ranked<T>(revision: unknown, load: () => Promise<T>): Promise<T> {
    const key = `${this.namespace}:rank:${hash([await this.version('jobs'), revision])}`;
    return this.memo(key, 30, async () => {
      try { if (this.redis.status === 'ready') { const raw = await this.redis.get(key); if (raw) return JSON.parse(raw, (key, value) => key === 'publishedAt' && typeof value === 'string' ? new Date(value) : value) as T; } } catch {}
      const value = await load();
      try { if (this.redis.status === 'ready') await this.redis.set(key, JSON.stringify(value), 'EX', 30); } catch {}
      return value;
    });
  }
  shadow(revision: string, run: () => Promise<unknown>) {
    if (this.running >= 2 || (this.shadowRuns.get(revision) || 0) > Date.now()) return;
    this.shadowRuns.set(revision, Date.now() + 30_000);
    while (this.shadowRuns.size > 1000) this.shadowRuns.delete(this.shadowRuns.keys().next().value!);
    this.running++;
    const launch=()=>setImmediate(() => { void run().catch(() => {}).finally(() => { this.running--; }); });
    const tasks=this.deferred.getStore();
    if(tasks)tasks.push({launch,cancel:()=>{this.running--;this.shadowRuns.delete(revision);}});else launch();
  }
  inRequest<T>(response:Response,handler:()=>Observable<T>):Observable<T>{
    return new Observable(subscriber=>{
      const tasks:Array<{launch:()=>void;cancel:()=>void}>=[];
      response.once('finish',()=>{for(const task of tasks)task.launch();tasks.length=0;});
      response.once('close',()=>{for(const task of tasks)task.cancel();tasks.length=0;});
      const subscription=this.deferred.run(tasks,()=>handler().subscribe(subscriber));
      return()=>subscription.unsubscribe();
    });
  }
  onModuleDestroy() { this.redis.disconnect(); }
}

/** Successful HTTP writes invalidate before the response reaches a candidate. */
@Injectable()
class CandidateInvalidationInterceptor implements NestInterceptor {
  constructor(private cache: CandidateCache) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{method:string;originalUrl?:string;url:string}>();
    const path = request.originalUrl || request.url;
    const handler=()=>['GET','HEAD','OPTIONS'].includes(request.method) || !/\/api\/(profiles|jobs|applications|companies|admin)\b/.test(path)
      ?next.handle():next.handle().pipe(mergeMap(async value => { const catalogChanged=/\/admin\/(catalog|employee-matching)/.test(path);invalidateHrRanking(catalogChanged);await this.cache.invalidate(catalogChanged); return value; }));
    return this.cache.inRequest(context.switchToHttp().getResponse<Response>(),handler);
  }
}
@Global()
@Module({ providers: [CandidateCache, {provide: APP_INTERCEPTOR,useClass:CandidateInvalidationInterceptor}], exports:[CandidateCache] })
export class CandidateCacheModule {}
