import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DesiredSelection } from '@job-talentio/shared';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { PositionGroupService } from './position-group.service';
import { PositionSearchIndex } from './position-search-index';
import { PrismaService } from '../prisma/prisma.service';
import { liveJobWhere } from '../benefits/benefit-policy';

export type PositionScope = 'candidate' | 'role' | 'directory' | 'admin';
type Option = DesiredSelection & { name: string; selectable: boolean; slug?: string; family?: string };
type Entry = Option & { key: string; label: string; aliases: string[] };
const normalize = catalogTitleIdentityKey;
const option = ({ key, label, aliases, ...publicFields }: Entry): Option => publicFields;
const ref = (row: DesiredSelection) => row.kind + ':' + row.id;
const documentId = (row: DesiredSelection) => createHash('sha256').update(ref(row)).digest('hex');
const compare = (a: Entry, b: Entry) => a.name.localeCompare(b.name, 'en') || ref(a).localeCompare(ref(b), 'en');

export function positionMatchTier(query: string, label: string, aliases: string[]) {
  if (!query) return 0;
  if (query === label) return 0;
  if (aliases.includes(query)) return 1;
  const tokens = query.split('-');
  return [label, ...aliases].some(text => {
    if (text.startsWith(query)) return true;
    const words = text.split('-');
    return tokens.every((token, i) => words.some(word => word === token || (i === tokens.length - 1 && word.startsWith(token))));
  }) ? 2 : null;
}

@Injectable()
export class PositionCatalogService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private current?: { roles: object; release: string | null; value: ReturnType<PositionCatalogService['project']> };
  private readonly logger = new Logger(PositionCatalogService.name);

  constructor(private catalog: EmployeeCatalogSnapshot, private groups: PositionGroupService, private meili: PositionSearchIndex,
    private prisma: PrismaService) {}

  onModuleInit() {
    const refresh = () => void this.snapshot().catch((error: Error) => this.logger.warn(error.message));
    refresh();
    this.timer = setInterval(refresh, 20_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private project(
    catalog: Awaited<ReturnType<EmployeeCatalogSnapshot['get']>>,
    group: Awaited<ReturnType<PositionGroupService['snapshot']>>,
  ) {
    const entries = new Map<string, Entry>();
    const active = new Map(catalog.roles.filter(role => !role.archivedAt).map(role => [role.id, role]));
    const add = (data: Option, labels: Array<string | null | undefined>) => {
      const key = documentId(data);
      const aliases = new Set([...(entries.get(ref(data))?.aliases ?? []), ...labels.filter(Boolean).map(text => normalize(text!))]);
      entries.set(ref(data), { ...data, key, label: normalize(data.name), aliases: [...aliases].filter(Boolean).sort() });
    };
    const canonicalRows = new Map<string, string[]>();
    const canonicalOf = new Map<string, string>();
    const slugs = new Map<string, string>();
    for (const row of active.values()) {
      const identity = catalog.index.identity(row.id);
      const role = active.get(identity?.canonicalRoleId ?? row.id)!;
      add({ kind: 'ROLE', id: role.id, name: group?.labels.get(role.id) ?? role.name, slug: role.slug,
        family: role.family?.name, selectable: Boolean(identity) },
        [row.name, row.nameId, row.nameUz, row.nameRu, ...row.aliases.filter(alias => alias.matchingApproved).map(alias => alias.alias)]);
      const rows = canonicalRows.get(role.id) ?? [];
      rows.push(row.id);
      canonicalRows.set(role.id, rows);
      canonicalOf.set(row.id, role.id);
      slugs.set(row.slug, role.id);
    }
    const members = new Map(group?.choices.map(choice => [choice.id, new Set(choice.members)]));
    for (const row of group?.groups ?? []) {
      const head = row.sourceRoleId ? entries.get('ROLE:' + row.sourceRoleId) : undefined;
      const aliases = (row.source as { searchAliases?: string[] })?.searchAliases ?? [];
      add({ kind: 'GROUP', id: row.id, name: row.nameEn, selectable: true }, [...aliases, ...head?.aliases ?? []]);
    }
    const ordered = [...entries.values()].sort(compare);
    const revision = createHash('sha256').update(JSON.stringify(['positions-v1', ordered, group?.releaseId])).digest('hex').slice(0, 24);
    const documents = ordered.map(row => ({ id: row.key, name: row.label.replace(/-/g, ' '),
      aliases: row.aliases.map(alias => alias.replace(/-/g, ' ')), kind: row.kind, selectable: row.selectable, revision }));
    return { ordered, entries, members, canonicalRows, canonicalOf, slugs, revision, documents, groupReleaseVersion: group?.releaseId ?? null };
  }

  async snapshot() {
    const catalog = await this.catalog.get();
    const group = await this.groups.snapshot(catalog.roles);
    const release = group?.releaseId ?? null;
    const previous = this.current;
    const value = previous?.roles === catalog.roles && previous.release === release
      ? previous.value : this.project(catalog, group);
    this.current = { roles: catalog.roles, release, value };
    this.meili.ensure(value.revision, value.documents);
    return value;
  }

  async search(input: { q: string; page: number; limit: number; scope: PositionScope; groupId?: string; selections?: DesiredSelection[]; reviewedOnly?: boolean }) {
    const catalog = await this.snapshot();
    const query = normalize(input.q);
    const memberIds = input.groupId ? catalog.members.get(input.groupId) : undefined;
    if (input.groupId && !memberIds) throw new BadRequestException('Unknown active group');
    const selected = input.selections ? new Set(input.selections.map(row => ref(row.kind === 'ROLE'
      ? { ...row, id: catalog.canonicalOf.get(row.id) ?? row.id } : row))) : undefined;
    const local = input.q.trim() && !query ? [] : catalog.ordered.filter(row => (!input.reviewedOnly || row.selectable)
      && (!memberIds || row.kind === 'ROLE' && memberIds.has(row.id))
      && (!selected || selected.has(ref(row))) && (input.scope === 'candidate' || row.kind === 'ROLE'));
    const fuzzy = query && !selected ? await this.meili.search(catalog.revision, query.replace(/-/g, ' '), input.scope !== 'candidate' || Boolean(memberIds)) : [];
    const fuzzyRank = new Map(fuzzy?.map((key, index) => [key, index]));
    const ranked = local.flatMap(row => {
      const tier = positionMatchTier(query, row.label, row.aliases);
      return tier !== null ? [{ row, tier, rank: 0 }]
        : fuzzyRank.has(row.key) ? [{ row, tier: 3, rank: fuzzyRank.get(row.key)! }] : [];
    }).sort((a, b) => a.tier - b.tier || a.rank - b.rank || compare(a.row, b.row));
    const items = ranked.slice((input.page - 1) * input.limit, input.page * input.limit)
      .map(({ row }) => ({ ...option(row), selectable: input.scope === 'admin' || row.selectable, reviewed: row.selectable }));
    const counts = input.scope === 'directory' && items.length ? await this.prisma.jobPost.groupBy({
      by: ['jobTitleId'],
      where: { ...liveJobWhere(), jobTitleId: { in: items.flatMap(row => catalog.canonicalRows.get(row.id) ?? []) },
        company: { isBanned: false, anonymizedAt: null } },
      _count: { _all: true },
    }) : [];
    const byId = new Map(counts.map(row => [row.jobTitleId, row._count._all]));
    return {
      items: items.map(row => ({ ...row, ...(input.scope === 'directory' ? {
        count: (catalog.canonicalRows.get(row.id) ?? []).reduce((sum, id) => sum + (byId.get(id) ?? 0), 0),
      } : {}) })),
      total: ranked.length, page: input.page, totalPages: Math.max(1, Math.ceil(ranked.length / input.limit)),
      searchState: fuzzy === null ? 'DEGRADED' : 'READY', revision: catalog.revision, groupReleaseVersion: catalog.groupReleaseVersion,
    };
  }

  async describe(selections: DesiredSelection[]) {
    if (!selections.length) return [];
    const { entries } = await this.snapshot();
    return selections.map(value => {
      const row = entries.get(ref(value));
      return row ? option(row) : { ...value, name: value.id, selectable: false };
    });
  }

  async validate(selections: DesiredSelection[]) {
    const options = await this.describe(selections);
    if (options.some(row => !row.selectable)) throw new BadRequestException('POSITION_UNAVAILABLE');
    return selections;
  }

  async jobTitleIds(selections: DesiredSelection[], slugs: string[] = []) {
    const catalog = await this.snapshot();
    const roots = new Set(slugs.flatMap(slug => catalog.slugs.get(slug) ?? []));
    for (const selection of selections) {
      if (selection.kind === 'ROLE') roots.add(catalog.canonicalOf.get(selection.id) ?? selection.id);
      else for (const member of catalog.members.get(selection.id) ?? []) roots.add(member);
    }
    return [...roots].flatMap(root => catalog.canonicalRows.get(root) ?? []);
  }

}
