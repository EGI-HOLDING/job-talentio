import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { jobFingerprint } from '../common/dedupe';

export const TABLES = ['Country', 'Province', 'City', 'JobCategory', 'IndustryGroup', 'Industry',
  'Skill', 'Language', 'Benefit', 'JobTitle', 'CityAlias', 'SkillAlias', 'LanguageAlias', 'BenefitAlias', 'JobTitleAlias'] as const;
export const STAGING = { project: 'f17bda5e-5f0c-4fd2-8fa9-25d568190f54', environment: '1ca9b621-8626-4db8-afe5-3f9ebce7ea54' };
type Row = Record<string, any>;
type Db = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
type Column = { name: string; type: string; nullable: boolean };
type Table = { columns: Column[]; rows: Row[] };
type ForeignKey = { name: string; child: string; parent: string; columns: string[]; referenced: string[]; definition: string };
export type Snapshot = { version: 1; source: string; exportedAt: string; tables: Record<string, Table>; hashes: Record<string, string>; sha256: string };
type State = { tables: Record<string, Table>; foreignKeys: ForeignKey[]; related: Record<string, Table>; unique: Record<string, string[][]>; identity: string };
const JOINS = new Set(['ProfileSkill', 'JobPostSkill', 'JobAlertSkill', 'ProfileLanguage', 'JobPostLanguage', 'JobPostBenefit', '_EmployeePreferredCountries']);
const PROTECTED = ['User', 'Company', 'JobPost', 'EmployeeProfile', 'Resume', 'Application', 'Conversation', 'ChatMessage', 'Payment', 'JobPurchaseOrder'];
export const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const tableName = (s: string) => 'public.' + quote(s);
const literalTables = TABLES.map(t => "'" + t + "'").join(',');
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const sha256 = (value: any) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const sortedRows = (rows: Row[]) => [...rows].sort((a, b) => ordinal(canonical(a), canonical(b)));
const tableHash = (table: Table) => sha256({ columns: table.columns, rows: sortedRows(table.rows) });

async function readTable(db: Db, name: string): Promise<Table> {
  const columns = await db.$queryRawUnsafe<Column[]>(`SELECT a.attname::text AS name, format_type(a.atttypid,a.atttypmod) AS type,
    NOT a.attnotnull AS nullable FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, name);
  if (!columns.length) throw new Error('Missing table: ' + name);
  const data = await db.$queryRawUnsafe<Array<{ data: Row }>>(`SELECT to_jsonb(t) AS data FROM ${tableName(name)} t`);
  return { columns, rows: sortedRows(data.map(r => r.data)) };
}

export async function readSnapshot(db: Db, source: string): Promise<Snapshot> {
  const tables: Record<string, Table> = {}, hashes: Record<string, string> = {};
  for (const name of TABLES) { tables[name] = await readTable(db, name); hashes[name] = tableHash(tables[name]); }
  return { version: 1, source, exportedAt: new Date().toISOString(), tables, hashes, sha256: sha256(hashes) };
}

export function validateSnapshot(snapshot: Snapshot) {
  if (snapshot.source !== 'talentio_hr_demo') throw new Error('Only the frozen current local application snapshot is allowed');
  if (snapshot.version !== 1 || Object.keys(snapshot.tables).sort().join() !== [...TABLES].sort().join()) throw new Error('Invalid snapshot tables/version');
  for (const name of TABLES) {
    const table = snapshot.tables[name];
    if (!table.columns.some(c => c.name === 'id')) throw new Error('Missing snapshot primary key: ' + name);
    const columns = table.columns.map(c => c.name).sort().join();
    if (new Set(table.rows.map(r => r.id)).size !== table.rows.length || table.rows.some(r => Object.keys(r).sort().join() !== columns)) throw new Error('Incomplete or duplicate snapshot rows: ' + name);
    if (tableHash(table) !== snapshot.hashes[name]) throw new Error('Snapshot checksum mismatch: ' + name);
  }
  if (sha256(snapshot.hashes) !== snapshot.sha256) throw new Error('Snapshot fingerprint mismatch');
}

async function identities(db: Db) {
  const result: Record<string, string[]> = {};
  for (const name of PROTECTED) result[name] = (await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM ${tableName(name)} ORDER BY id`)).map(r => r.id).sort(ordinal);
  return sha256(result);
}

async function readState(db: Db): Promise<State> {
  const snapshot = await readSnapshot(db, 'target');
  const foreignKeys = await db.$queryRawUnsafe<ForeignKey[]>(`SELECT c.conname::text AS name,ch.relname::text AS child,pa.relname::text AS parent,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS referenced,
    pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_class pa ON pa.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=ch.relnamespace WHERE c.contype='f' AND n.nspname='public' AND pa.relname IN (${literalTables}) ORDER BY ch.relname,c.conname`);
  foreignKeys.sort((a, b) => ordinal(canonical([a.child, a.name]), canonical([b.child, b.name])));
  if (foreignKeys.some(f => f.columns.length !== 1 || f.referenced.join() !== 'id')) throw new Error('Unsupported catalog foreign key');
  const related: Record<string, Table> = {}, unique: Record<string, string[][]> = {};
  const externalSchema = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT c.conname::text AS name FROM pg_constraint c
    JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=ch.relnamespace
    WHERE c.contype='f' AND pn.nspname='public' AND cn.nspname<>'public' AND p.relname IN (${literalTables})`);
  if (externalSchema.length) throw new Error('Catalog references outside the public schema require review');
  for (const name of [...new Set(foreignKeys.map(f => f.child))].filter(t => !(TABLES as readonly string[]).includes(t))) {
    related[name] = await readTable(db, name);
    const indexes = await db.$queryRawUnsafe<Array<{ columns: string[] }>>(`SELECT ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num WHERE k.ord<=i.indnkeyatts ORDER BY k.ord) AS columns
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname=$1 AND i.indisunique AND i.indexprs IS NULL AND i.indpred IS NULL ORDER BY i.indexrelid`, name);
    unique[name] = indexes.map(r => r.columns).sort((a, b) => ordinal(canonical(a), canonical(b)));
    if (!related[name].columns.some(c => c.name === 'id') && name !== '_EmployeePreferredCountries') throw new Error('Unsupported relation identity: ' + name);
  }
  // Deleting a lookup association must never cascade into another business table.
  const cascading = await db.$queryRawUnsafe<Array<{ parent: string }>>(`SELECT p.relname::text AS parent FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid
    WHERE c.contype='f' AND p.relname IN (${[...JOINS].map(t => "'" + t + "'").join(',')})`);
  if (cascading.length) throw new Error('Unexpected incoming references to catalog association tables');
  const triggers = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT g.tgname::text AS name FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE NOT g.tgisinternal AND n.nspname='public' AND t.relname::text=ANY($1::text[])`, [...TABLES, ...Object.keys(related)]);
  if (triggers.length) throw new Error('Custom triggers on synchronized tables require review');
  return { tables: snapshot.tables, foreignKeys, related, unique, identity: await identities(db) };
}

const normalize = (s: any) => typeof s === 'string' ? s.normalize('NFKC').toLowerCase().replace(/[‘’ʻʼ]/g, "'").replace(/\s+/g, ' ').trim() : '';
const fields = (r: Row) => [r.name, r.nameUz, r.nameRu, r.nameId].map(normalize).filter(Boolean);

function mapping(source: Snapshot, target: State) {
  const maps: Record<string, Record<string, string | null>> = {}, conflicts: string[] = [];
  const has = (table: string) => (TABLES as readonly string[]).includes(table);
  for (const name of TABLES.filter(t => !t.endsWith('Alias'))) {
    maps[name] = Object.create(null);
    const src = source.tables[name].rows, srcAliases = has(name + 'Alias') ? source.tables[name + 'Alias'].rows : [];
    const dstAliases = has(name + 'Alias') ? target.tables[name + 'Alias'].rows : [];
    const aliasFk = name[0].toLowerCase() + name.slice(1) + 'Id';
    const labels = (rows: Row[], aliases: Row[]) => {
      const grouped = new Map<string, string[]>();
      for (const r of rows) grouped.set(r.id, fields(r));
      for (const a of aliases) grouped.get(a[aliasFk])?.push(normalize(a.alias));
      return grouped;
    };
    const sourceLabels = labels(src, srcAliases), targetLabels = labels(target.tables[name].rows, dstAliases);
    for (const old of target.tables[name].rows) {
      const parentField = name === 'Province' ? 'countryId' : name === 'City' ? 'provinceId' : name === 'Industry' ? 'groupId' : null;
      const parentTable = name === 'Province' ? 'Country' : name === 'City' ? 'Province' : 'IndustryGroup';
      const candidates = src.filter(r => !parentField || r[parentField] === maps[parentTable]?.[old[parentField]]);
      const names = targetLabels.get(old.id)!;
      const priorities = [
        (r: Row) => r.id === old.id,
        (r: Row) => name === 'Country' ? r.iso2 === old.iso2 : name === 'Language' ? r.code === old.code : Boolean(old.sourceCode && r.sourceCode === old.sourceCode),
        (r: Row) => Boolean(old.slug && r.slug === old.slug),
        (r: Row) => Boolean(old.normalizedKey && r.normalizedKey === old.normalizedKey),
        (r: Row) => sourceLabels.get(r.id)!.some(n => names.includes(n)),
      ];
      let matched: Row[] = [];
      for (const predicate of priorities) { matched = candidates.filter(predicate); if (matched.length) break; }
      if (matched.length > 1) conflicts.push('Ambiguous ' + name + ':' + old.id);
      maps[name][old.id] = matched.length === 1 ? matched[0].id : null;
    }
  }
  return { maps, conflicts };
}

function buildPlan(snapshot: Snapshot, state: State) {
  validateSnapshot(snapshot);
  for (const name of TABLES) if (canonical(snapshot.tables[name].columns) !== canonical(state.tables[name].columns)) throw new Error('Catalog schema differs: ' + name);
  const { maps, conflicts } = mapping(snapshot, state), related: Record<string, Row[]> = {}, detached: Record<string, number> = {}, changes: Record<string, number> = {};
  for (const [name, table] of Object.entries(state.related)) {
    const fks = state.foreignKeys.filter(f => f.child === name);
    const rows: Row[] = [];
    for (const old of table.rows) {
      const next = { ...old }; let remove = false;
      for (const fk of fks) {
        const field = fk.columns[0];
        if (old[field] == null) continue;
        const mapped = maps[fk.parent]?.[old[field]];
        if (mapped === undefined) { conflicts.push('Unmapped foreign key ' + name + '.' + field); continue; }
        if (mapped === null) {
          detached[name + '.' + field] = (detached[name + '.' + field] || 0) + 1;
          if (table.columns.find(c => c.name === field)!.nullable) next[field] = null;
          else if (JOINS.has(name)) remove = true;
          else conflicts.push('Required business reference cannot be detached: ' + name + '.' + field);
        } else next[field] = mapped;
      }
      if (name === 'JobPost' && next.cityId !== old.cityId) next.fingerprint = jobFingerprint(next as { title: string; workMode: string; cityId: string | null });
      if (remove || canonical(old) !== canonical(next)) changes[name] = (changes[name] || 0) + 1;
      if (!remove) rows.push(next);
    }
    const removed = new Set<Row>();
    for (const columns of state.unique[name]) {
      const seen = new Map<string, Row>();
      for (const row of rows) {
        if (removed.has(row) || columns.some(c => row[c] == null)) continue;
        const key = canonical(columns.map(c => row[c])), previous = seen.get(key);
        if (!previous) { seen.set(key, row); continue; }
        const payload = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k)));
        if (JOINS.has(name) && canonical(payload(previous)) === canonical(payload(row))) removed.add(row);
        else conflicts.push('Conflicting relation payload: ' + name + '(' + columns.join(',') + ')');
      }
    }
    related[name] = rows.filter(r => !removed.has(r));
  }
  const openings = new Set<string>();
  for (const row of related.JobPost || []) {
    if (!['DRAFT', 'PUBLISHED', 'PAUSED'].includes(row.status) || !row.fingerprint) continue;
    const key = canonical([row.companyId, row.fingerprint]);
    if (openings.has(key)) conflicts.push('Catalog reference changes collide with an active job fingerprint');
    openings.add(key);
  }
  const targetHash = sha256(state), hashes = Object.fromEntries(TABLES.map(t => [t, tableHash(state.tables[t])]));
  const tableChanges = Object.fromEntries(TABLES.map(t => [t, { before: state.tables[t].rows.length, after: snapshot.tables[t].rows.length, equal: hashes[t] === snapshot.hashes[t] }]));
  const detail = { version: 1, snapshotHash: snapshot.sha256, targetHash, mappings: maps, detached, changes, tableChanges, conflicts: [...new Set(conflicts)].sort(), protectedIdentity: state.identity };
  return { detail: { ...detail, planHash: sha256(detail) }, related };
}

export async function inspectPlan(db: PrismaClient, snapshot: Snapshot) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return buildPlan(snapshot, await readState(tx)).detail;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000 });
}

/** Full public-schema data receipt used to verify an isolated pg_dump restore. */
export async function databaseDigest(db: PrismaClient) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const names = await tx.$queryRawUnsafe<Array<{ name: string }>>("SELECT tablename::text AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const tables: Record<string, { rows: number; sha256: string }> = {};
    for (const { name } of names) { const table = await readTable(tx, name); tables[name] = { rows: table.rows.length, sha256: tableHash(table) }; }
    return { tables, sha256: sha256(tables) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000 });
}

async function insertRows(db: Db, name: string, table: Table, rows = table.rows) {
  const columns = table.columns.map(c => quote(c.name)).join(',');
  for (let offset = 0; offset < rows.length; offset += 250) await db.$executeRawUnsafe(`INSERT INTO ${tableName(name)} (${columns}) SELECT ${columns}
    FROM jsonb_populate_recordset(NULL::${tableName(name)},$1::jsonb)`, JSON.stringify(rows.slice(offset, offset + 250)));
}

/** All constraint DDL, reference changes, catalog replacement and verification roll back together. */
export async function applySnapshot(db: PrismaClient, snapshot: Snapshot, expectedPlan: string, fault?: 'after-delete') {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='15s'");
    const initial = await readState(tx);
    const locked = [...new Set([...TABLES, ...Object.keys(initial.related), ...PROTECTED])].sort();
    await tx.$executeRawUnsafe('LOCK TABLE ' + locked.map(tableName).join(',') + ' IN ACCESS EXCLUSIVE MODE');
    const state = await readState(tx), plan = buildPlan(snapshot, state);
    if (plan.detail.planHash !== expectedPlan) throw new Error('Target changed since dry-run; no changes applied');
    if (plan.detail.conflicts.length) throw new Error('Resolve dry-run conflicts before apply');
    if (Object.values(plan.detail.tableChanges).every(t => t.equal) && !Object.keys(plan.detail.changes).length) return { ...plan.detail, applied: false, verified: true };
    for (const fk of state.foreignKeys) await tx.$executeRawUnsafe(`ALTER TABLE ${tableName(fk.child)} DROP CONSTRAINT ${quote(fk.name)}`);
    for (const name of [...TABLES].reverse()) await tx.$executeRawUnsafe('DELETE FROM ' + tableName(name));
    if (fault === 'after-delete') throw new Error('Injected rollback exercise');
    for (const name of TABLES) await insertRows(tx, name, snapshot.tables[name]);
    for (const [name, table] of Object.entries(state.related)) {
      const next = plan.related[name];
      if (!table.columns.some(c => c.name === 'id')) {
        await tx.$executeRawUnsafe('DELETE FROM ' + tableName(name));
        await insertRows(tx, name, table, next);
        continue;
      }
      const nextIds = new Set(next.map(r => r.id)), deleted = table.rows.filter(r => !nextIds.has(r.id));
      if (deleted.length) {
        if (!JOINS.has(name)) throw new Error('Refusing business row deletion');
        await tx.$executeRawUnsafe(`DELETE FROM ${tableName(name)} WHERE id = ANY($1::text[])`, deleted.map(r => r.id));
      }
      const columns = [...new Set(state.foreignKeys.filter(f => f.child === name).flatMap(f => f.columns))];
      if (name === 'JobPost') columns.push('fingerprint');
      const old = new Map(table.rows.map(r => [r.id, r]));
      const updates = next.filter(r => columns.some(c => r[c] !== old.get(r.id)?.[c]));
      for (let offset = 0; offset < updates.length; offset += 250) await tx.$executeRawUnsafe(`UPDATE ${tableName(name)} t SET ${columns.map(c => quote(c) + '=s.' + quote(c)).join(',')}
        FROM jsonb_populate_recordset(NULL::${tableName(name)},$1::jsonb) s WHERE t.id=s.id`, JSON.stringify(updates.slice(offset, offset + 250)));
    }
    for (const fk of state.foreignKeys) await tx.$executeRawUnsafe(`ALTER TABLE ${tableName(fk.child)} ADD CONSTRAINT ${quote(fk.name)} ${fk.definition}`);
    const after = await readSnapshot(tx, 'verified-target');
    if (after.sha256 !== snapshot.sha256) throw new Error('Post-import catalog fingerprint mismatch');
    if (await identities(tx) !== state.identity) throw new Error('Protected business identities changed');
    for (const [name, rows] of Object.entries(plan.related)) if (canonical(sortedRows((await readTable(tx, name)).rows)) !== canonical(sortedRows(rows))) throw new Error('Reference verification failed: ' + name);
    await tx.$executeRawUnsafe(`INSERT INTO "AuditLog" (id,action,"entityType","entityId",metadata,"createdAt") VALUES ($1,'CATALOG_SNAPSHOT_SYNC','CatalogSnapshot',$2,$3::jsonb,NOW())`,
      'catalog-sync:' + plan.detail.planHash, snapshot.sha256, JSON.stringify({ planHash: plan.detail.planHash, snapshotHash: snapshot.sha256, targetHash: plan.detail.targetHash, detached: plan.detail.detached, changes: plan.detail.changes, identity: state.identity }));
    return { ...plan.detail, applied: true, verified: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 180000 });
}

export function assertStaging(env = process.env) {
  if (env.RAILWAY_PROJECT_ID !== STAGING.project || env.RAILWAY_ENVIRONMENT_ID !== STAGING.environment || env.RAILWAY_ENVIRONMENT_NAME !== 'staging') throw new Error('Only the approved Railway staging environment is allowed');
}
