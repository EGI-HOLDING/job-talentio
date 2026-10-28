// Explicit, audited local catalog import. Never invoked by seed or startup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');
const repo = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = text => text.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/c\+\+/g, 'cplusplus').replace(/c#/g, 'csharp').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const batches = (items, size = 300) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const mergeOwner = (id, merges) => merges.find(merge => merge.from === id)?.to || id;
// Same fingerprint format as apps/api/src/common/dedupe.ts.
const jobFingerprint = post => sha(post.title.toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яёўғқҳ\s]+/gi, ' ')
  .replace(/\s+/g, ' ').trim() + '|' + post.workMode + '|' + (post.cityId ?? 'none'));

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5434' || url.pathname !== '/job_talentio') throw new Error('Only the approved local database is allowed');
  const file = path.join(repo, 'apps/api/prisma/data/job-titles/audit-2026-10-24.json');
  const dataset = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = new PrismaClient();
  const directory = path.join(repo, 'output/catalog-import/job-title-audit-2026-10-24');
  fs.mkdirSync(directory, { recursive: true });
  try {
    const before = { titles: await db.jobTitle.findMany({ orderBy: { id: 'asc' } }), aliases: await db.jobTitleAlias.findMany({ orderBy: { id: 'asc' } }), jobPosts: await db.jobPost.count(), resumes: await db.resume.count() };
    const checkpoint = sha(JSON.stringify({ titles: before.titles, aliases: before.aliases }));
    const pendingMerges = dataset.merges.filter(merge => !before.titles.find(t => t.id === merge.from)?.archivedAt);
    const existing = new Map(before.titles.map(title => [title.id, title]));
    const after = new Map(before.titles.map(title => [title.id, { ...title }]));
    for (const merge of pendingMerges) {
      if (!after.has(merge.from) || !after.has(merge.to)) throw new Error('Merge source/target missing');
      const retired = after.get(merge.from);
      after.set(merge.from, { ...retired, archivedAt: new Date(), normalizedKey: 'merged-' + sha(merge.from).slice(0, 24), slug: 'merged-' + sha(merge.from).slice(0, 24) });
    }
    const changes = [];
    const sources = new Map();
    for (const row of dataset.rows) {
      for (const field of ['name','nameId','nameUz']) if (!row[field]?.trim() || row[field].length > 120 || /[\u0000-\u001f\ufffd]/.test(row[field])) throw new Error('Invalid label: ' + row.key);
      const old = existing.get(row.targetId);
      if (old?.archivedAt) throw new Error('Would revive an archived catalog entry: ' + old.name);
      if (old?.curatedAt && old.name !== row.name) throw new Error('Would override a curated English name: ' + old.name);
      if (old?.curatedAt && ['nameId','nameUz'].some(field => old[field] && old[field] !== row[field])) throw new Error('Would override a curated translation: ' + old.name);
      const nameChanged = old && old.name !== row.name;
      const normalizedKey = old && !nameChanged ? old.normalizedKey : identity(row.name);
      let slug = old && !nameChanged ? old.slug : identity(row.name).slice(0, 100);
      if ([...after.values()].some(t => t.id !== row.targetId && t.slug === slug)) slug = slug.slice(0, 80) + '-' + sha(row.key).slice(0, 10);
      const desired = {
        id: row.targetId, name: row.name, nameId: row.nameId, nameUz: row.nameUz,
        normalizedKey, slug,
        nameIdIsMachine: old?.nameId === row.nameId ? old.nameIdIsMachine : true,
        nameUzIsMachine: old?.nameUz === row.nameUz ? old.nameUzIsMachine : true,
        ...(!old ? { i18nStatus: 'PENDING' } : {}),
      };
      const fields = Object.keys(desired).filter(field => desired[field] !== old?.[field]);
      if (fields.length) changes.push({ id: row.targetId, create: !old, data: Object.fromEntries(fields.map(field => [field, desired[field]])), row });
      after.set(row.targetId, { ...old, ...desired });
      sources.set(row.targetId, row);
    }
    const renamed = changes.filter(change => !change.create && change.data.name && change.data.name !== existing.get(change.id)?.name);
    const affectedIds = [...new Set([...renamed.map(c => c.id), ...dataset.merges.flatMap(m => [m.from,m.to])])];
    const affectedPosts = affectedIds.length ? await db.jobPost.findMany({where:{jobTitleId:{in:affectedIds}},select:{id:true,jobTitleId:true,title:true,workMode:true,cityId:true,fingerprint:true}}) : [];
    const fingerprintRepairs = affectedPosts.flatMap(post => {
      const change = renamed.find(c => c.id === post.jobTitleId);
      const title = change && post.title === existing.get(change.id)?.name ? change.data.name : post.title;
      const fingerprint = jobFingerprint({...post,title});
      return fingerprint === post.fingerprint ? [] : [{id:post.id,before:post.fingerprint,after:fingerprint}];
    });
    const active = [...after.values()].filter(title => !title.archivedAt);
    const canonical = new Map();
    const collisions = [];
    for (const title of active) {
      for (const label of [title.name, title.nameId, title.nameUz].filter(Boolean)) {
        const key = identity(label);
        const owner = canonical.get(key);
        if (owner && owner !== title.id) collisions.push({ kind:'label', label, owners:[owner,title.id] });
        else canonical.set(key,title.id);
      }
    }
    const retiredAliases = [];
    for (const row of dataset.rows) {
      const old = existing.get(row.targetId);
      if (!old) continue;
      const currentLabels = new Set([row.name,row.nameId,row.nameUz,...(row.aliases || [])].map(identity));
      for (const field of ['nameId','nameUz']) {
        if (!old[field] || old[field] === row[field]) continue;
        const key = identity(old[field]);
        const alias = before.aliases.find(a => a.aliasKey === key && a.jobTitleId === row.targetId);
        // Only retire aliases created by this importer for its own replaced
        // editorial translation. Never delete an admin/user-created alias.
        if (alias?.id === 'role_alias_' + sha(key).slice(0,32) && !currentLabels.has(key)) retiredAliases.push(alias);
      }
    }
    const retiredIds = new Set(retiredAliases.map(a => a.id));
    const aliases = new Map(before.aliases.filter(a => !retiredIds.has(a.id)).map(alias => [alias.aliasKey, { ...alias, jobTitleId: mergeOwner(alias.jobTitleId, dataset.merges) }]));
    const newAliases = [];
    for (const row of dataset.rows) {
      const old = existing.get(row.targetId);
      const desired = after.get(row.targetId);
      const labels = [row.name, row.nameId, row.nameUz, ...(row.aliases || []), row.source.preferredLabelEn, old?.name, old?.slug].filter(Boolean);
      for (const label of labels) {
        const key = identity(label);
        if (!key) throw new Error('Empty alias key: ' + label);
        const alias = aliases.get(key);
        const primaryOwner = canonical.get(key);
        if ((alias && alias.jobTitleId !== row.targetId) || (primaryOwner && primaryOwner !== row.targetId)) {
          collisions.push({kind:'alias', label, target:row.targetId, owner:alias?.jobTitleId || primaryOwner});
          continue;
        }
        if (alias || key === desired.normalizedKey || key === desired.slug) continue;
        const item = { id:'role_alias_' + sha(key).slice(0,32), jobTitleId:row.targetId, alias:label, aliasKey:key };
        newAliases.push(item); aliases.set(key,item);
      }
    }
    const report = { datasetId:dataset.datasetId, sourceMapped:dataset.rows.filter(row => row.source.code).length, creates:changes.filter(c => c.create).length, updates:changes.filter(c => !c.create).length, merges:pendingMerges.length, aliases:newAliases.length, retiredEditorialAliases:retiredIds.size, renamedPostingFingerprintRepairs:fingerprintRepairs.length, activeAfter:active.length, collisions };
    fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if (collisions.length) throw new Error('Catalog identities conflict; nothing was written');
    if (!process.argv.includes('--apply')) return;
    const stamp = Date.now();
    fs.writeFileSync(path.join(directory,`before-${stamp}.json`),JSON.stringify({...before,affectedPosts},null,2));
    await db.$transaction(async tx => {
      const live = { titles:await tx.jobTitle.findMany({orderBy:{id:'asc'}}), aliases:await tx.jobTitleAlias.findMany({orderBy:{id:'asc'}}) };
      if (sha(JSON.stringify(live)) !== checkpoint) throw new Error('Catalog changed after planning; rerun to review the current state');
      if (retiredIds.size) await tx.jobTitleAlias.deleteMany({where:{id:{in:[...retiredIds]}}});
      for (const merge of pendingMerges) {
        const retired = after.get(merge.from);
        await tx.jobTitle.update({where:{id:merge.from},data:{archivedAt:retired.archivedAt,slug:retired.slug,normalizedKey:retired.normalizedKey}});
        await tx.jobPost.updateMany({where:{jobTitleId:merge.from},data:{jobTitleId:merge.to}});
        await tx.resume.updateMany({where:{targetJobTitleId:merge.from},data:{targetJobTitleId:merge.to}});
        await tx.jobTitleAlias.updateMany({where:{jobTitleId:merge.from},data:{jobTitleId:merge.to}});
        await tx.auditLog.create({data:{action:'MERGE_DUPLICATE_JOB_TITLE_AUDIT',entityType:'JobTitle',entityId:merge.to,metadata:{...merge,before:JSON.parse(JSON.stringify(existing.get(merge.from))),relationshipsRetained:true}}});
      }
      for (const chunk of batches(changes.filter(c => c.create))) await tx.jobTitle.createMany({data:chunk.map(c => c.data)});
      for (const change of changes.filter(c => !c.create)) {
        const { id, ...data } = change.data;
        await tx.jobTitle.update({where:{id:change.id},data});
        const old = existing.get(change.id);
        if (data.name && data.name !== old.name) {
          await tx.jobPost.updateMany({where:{jobTitleId:change.id,title:old.name},data:{title:data.name}});
        }
      }
      for (const chunk of batches(newAliases,800)) await tx.jobTitleAlias.createMany({data:chunk});
      for (const repair of fingerprintRepairs) {
        const changed = await tx.jobPost.updateMany({where:{id:repair.id,fingerprint:repair.before},data:{fingerprint:repair.after}});
        if (changed.count !== 1) throw new Error('Affected posting changed while planning; retry the import');
        await tx.auditLog.create({data:{action:'REPAIR_CATALOG_RENAME_FINGERPRINT',entityType:'JobPost',entityId:repair.id,metadata:{datasetId:dataset.datasetId,...repair}}});
      }
      const audits = dataset.rows.map(row => {
        const desired = after.get(row.targetId);
        return { id:'role_audit_'+sha(JSON.stringify({key:row.key,target:row.targetId,name:desired.name,id:desired.nameId,uz:desired.nameUz,aliases:row.aliases || []})).slice(0,32), action:'AUDIT_EXPAND_JOB_TITLE_CATALOG',entityType:'JobTitle',entityId:row.targetId,metadata:{datasetId:dataset.datasetId,source:row.source,labels:{en:desired.name,id:desired.nameId,uz:desired.nameUz},aliases:row.aliases || [],retiredEditorialAliases:retiredAliases.filter(a=>a.jobTitleId===row.targetId),labelStatus:row.labelStatus,provenance:dataset.provenance,changedFields:changes.find(c=>c.id===row.targetId)?Object.keys(changes.find(c=>c.id===row.targetId).data):[]}};
      });
      for (const chunk of batches(audits)) await tx.auditLog.createMany({data:chunk,skipDuplicates:true});
      if (await tx.jobPost.count() !== before.jobPosts || await tx.resume.count() !== before.resumes) throw new Error('Unexpected change in posting/resume totals');
      if (await tx.jobTitle.count({where:{archivedAt:null}}) !== active.length) throw new Error('Unexpected active title count');
    },{timeout:120000});
    fs.writeFileSync(path.join(directory,`applied-${stamp}.json`),JSON.stringify({...report,status:'applied'},null,2));
    console.log('Applied atomically; posting and resume totals preserved.');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode=1; });
