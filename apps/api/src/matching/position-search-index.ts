import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PositionIndexDocument = {
  id: string;
  name: string;
  aliases: string[];
  kind: 'ROLE' | 'GROUP';
  selectable: boolean;
  revision: string;
};

@Injectable()
export class PositionSearchIndex {
  private readonly logger = new Logger(PositionSearchIndex.name);
  private readonly host: string;
  private readonly key: string | undefined;
  private readonly prefix: string;
  private ready = '';
  private attempt?: { revision: string; work: Promise<void> };
  private retryAfter = 0;

  constructor(config: ConfigService) {
    this.host = (config.get<string>('MEILI_HOST') || '').replace(/\/$/, '');
    this.key = config.get<string>('MEILI_MASTER_KEY');
    this.prefix = config.get<string>('MEILI_POSITIONS_INDEX') || 'positions_v1';
    if (!/^[a-zA-Z0-9_-]+$/.test(this.prefix)) throw new Error('Invalid position index prefix');
  }

  private async request<T>(method: string, path: string, body?: unknown, timeout = 3000): Promise<T> {
    const response = await fetch(this.host + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: 'Bearer ' + this.key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error('Position index HTTP ' + response.status);
    return response.json() as Promise<T>;
  }

  private uid(revision: string) {
    return this.prefix + '_' + revision;
  }

  private async wait(taskUid: number) {
    const expires = Date.now() + 60_000;
    while (Date.now() < expires) {
      const task = await this.request<{ status: string }>('GET', '/tasks/' + taskUid);
      if (task.status === 'succeeded') return;
      if (task.status === 'failed' || task.status === 'canceled') throw new Error('Position indexing ' + task.status);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Position indexing timed out');
  }

  ensure(revision: string, documents: PositionIndexDocument[]) {
    if (!this.host || this.ready === revision || this.attempt || Date.now() < this.retryAfter) return;
    const work = this.publish(revision, documents).then(() => {
      this.ready = revision;
    }).catch((error: Error) => {
      this.retryAfter = Date.now() + 15_000;
      this.logger.warn(error.message);
    }).finally(() => {
      this.attempt = undefined;
    });
    this.attempt = { revision, work };
  }

  async prepare(revision: string, documents: PositionIndexDocument[]) {
    if (!this.host) throw new Error('MEILI_HOST is required to stage the position index');
    this.ensure(revision, documents);
    await this.attempt?.work;
    if (this.ready !== revision) throw new Error('Position index revision was not published');
    return this.uid(revision);
  }

  private async publish(revision: string, documents: PositionIndexDocument[]) {
    const uid = this.uid(revision);
    const path = '/indexes/' + uid;
    const stats = () => this.request<{ numberOfDocuments: number; isIndexing: boolean }>('GET', path + '/stats');
    const current = await stats().catch(() => null);
    if (current && !current.isIndexing && current.numberOfDocuments === documents.length && documents.length) {
      const first = await this.request<{ revision: string }>('GET', path + '/documents/' + documents[0].id).catch(() => null);
      if (first?.revision === revision) return;
    }
    if (!current) {
      const create = await this.request<{ taskUid: number }>('POST', '/indexes', { uid, primaryKey: 'id' });
      // Another process can create the same immutable revision first.
      await this.wait(create.taskUid).catch(async error => {
        if (!await stats().catch(() => null)) throw error;
      });
    }
    const settings = await this.request<{ taskUid: number }>('PATCH', path + '/settings', {
      searchableAttributes: ['name', 'aliases'],
      filterableAttributes: ['kind'],
      displayedAttributes: ['id', 'revision'],
      pagination: { maxTotalHits: 10_000 },
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness'],
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 5, twoTypos: 10 } },
    });
    await this.wait(settings.taskUid);
    for (let offset = 0; offset < documents.length; offset += 500) {
      const task = await this.request<{ taskUid: number }>('PUT', path + '/documents', documents.slice(offset, offset + 500), 10_000);
      await this.wait(task.taskUid);
    }
    if ((await stats()).numberOfDocuments !== documents.length) throw new Error('Position index coverage mismatch');
  }

  async search(revision: string, q: string, rolesOnly: boolean): Promise<string[] | null> {
    if (!this.host || this.ready !== revision) return null;
    try {
      const { hits } = await this.request<{ hits: Array<{ id: string; revision: string }> }>(
        'POST', '/indexes/' + this.uid(revision) + '/search', {
          q, limit: 1000, matchingStrategy: 'all',
          ...(rolesOnly ? { filter: 'kind = ROLE' } : {}),
        }, 900,
      );
      return hits.filter(hit => hit.revision === revision).map(hit => hit.id);
    } catch {
      if (this.ready === revision) this.ready = '';
      this.retryAfter = Date.now() + 15_000;
      return null;
    }
  }
}
