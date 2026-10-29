import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// This builds a research artifact only. It does not load .env, connect to a
// database, import application code, or run as part of seed/startup.
const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const pages = await Promise.all([0, 1, 2, 3].map(i => readJson(`sources/esco-occupations-page-${i}.json`)));
const sourceRows = pages.flatMap(p => p._embedded.results);
const sourceByName = new Map(sourceRows.map(r => [r.preferredLabel.en.toLowerCase(), r]));
if (sourceRows.length !== 3039 || new Set(sourceRows.map(r => r.uri)).size !== 3039) {
  throw new Error('Source page count or unique URI count does not match the downloaded ESCO dataset');
}
const sourceRegistry = await readJson('sources.json');
const sourceIds = new Set(sourceRegistry.map(s => s.id));
const input = await fs.readFile(path.join(root, 'draft-labels.txt'), 'utf8');
const families = [];
const rows = [];
let family;
const notesByName = {
  'chef': 'ESCO membedakan chef dan cook. Tanggung jawab perencanaan dapur, supervisi, dan pelaksanaan memasak perlu dicocokkan saat review lokal.',
  'cook': 'Jangan otomatis digabung dengan chef hanya karena keduanya diterjemahkan sebagai juru masak. Periksa perbedaan tanggung jawab.',
  'medical laboratory assistant': 'Asisten laboratorium medis; tidak otomatis setara dengan seluruh profesi analis/teknolog laboratorium medis di setiap negara.',
  'manufacturing manager': 'Periksa batas tugas terhadap manufacturing facility manager sebelum menentukan alias lokal.',
  'manufacturing facility manager': 'Periksa batas tugas terhadap manufacturing manager sebelum menentukan alias lokal.',
  'pharmacy technician': 'Nama dan kewenangan profesi kesehatan berbeda antarnegara; memerlukan tinjauan istilah lokal.',
};
for (const [index, raw] of input.split(/\r?\n/).entries()) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const fields = line.split('|').map(s => s.trim().normalize('NFC'));
  if (line.startsWith('@')) {
    if (fields.length !== 3) throw new Error(`Invalid family line ${index + 1}`);
    family = { key: fields[0].slice(1), nameId: fields[1], nameUz: fields[2] };
    families.push(family);
    continue;
  }
  if (!family || fields.length !== 3 || fields.some(s => !s)) throw new Error(`Invalid row ${index + 1}`);
  const [nameEn, nameId, nameUz] = fields;
  const source = sourceByName.get(nameEn.toLowerCase());
  if (!source || !/^\d{4}(?:\.|$)/.test(source.code)) throw new Error(`Unmatched ESCO label: ${nameEn}`);
  rows.push({
    key: `esco:${source.uri.split('/').at(-1)}`,
    reviewFamily: family.key,
    labels: { en: source.preferredLabel.en, id: nameId, uz: nameUz },
    labelStatus: { en: 'source_preferred_label', id: 'editorial_draft', uz: 'editorial_draft_native_review_needed' },
    sourceKind: 'esco',
    esco: { uri: source.uri, code: source.code, version: '1.2.1', preferredLabelEn: source.preferredLabel.en },
    isco08: { code: source.code.slice(0, 4), status: 'from_esco_classification' },
    nationalMappings: { kbji2026: null, mmk2025: null, status: 'not_crosswalked' },
    sourceRefs: ['esco'],
    sourceUrl: source.uri,
    aliasCandidates: [
      { value: nameId, language: 'id', status: 'translation_draft_requires_review' },
      { value: nameUz, language: 'uz', status: 'translation_draft_requires_review' },
    ],
    reviewStatus: 'pending',
    readyForImport: false,
    notes: notesByName[source.preferredLabel.en] || '',
  });
}
const extensionRows = await readJson('market-extensions.json');
for (const extension of extensionRows) {
  if (!sourceIds.has(extension.sourceId)) throw new Error(`Unknown source: ${extension.sourceId}`);
  const related = sourceByName.get(extension.relatedEscoTitle.toLowerCase());
  if (!related) throw new Error(`Unknown related ESCO title: ${extension.relatedEscoTitle}`);
  rows.push({
    key: `talentio-draft:${extension.key}`,
    reviewFamily: extension.family,
    labels: extension.labels,
    labelStatus: { en: 'editorial_market_label', id: 'editorial_draft', uz: 'editorial_draft_native_review_needed' },
    sourceKind: 'market_extension',
    esco: null,
    isco08: { code: null, status: 'unassigned' },
    relatedEsco: { uri: related.uri, preferredLabelEn: related.preferredLabel.en, relation: 'proposed_scope_relation_requires_review' },
    nationalMappings: { kbji2026: null, mmk2025: null, status: 'not_crosswalked' },
    sourceRefs: [extension.sourceId],
    sourceUrl: extension.url,
    observedTitle: extension.observedTitle,
    aliasCandidates: [
      { value: extension.labels.id, language: 'id', status: 'translation_draft_requires_review' },
      { value: extension.labels.uz, language: 'uz', status: 'translation_draft_requires_review' },
    ],
    reviewStatus: 'pending',
    readyForImport: false,
    notes: extension.note,
  });
}

const normalise = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const assertUnique = (values, name) => {
  const duplicates = values.filter((v, i) => values.indexOf(v) !== i);
  if (duplicates.length) throw new Error(`${name}: duplicate ${duplicates.join(', ')}`);
};
assertUnique(rows.map(r => r.key), 'stable key');
assertUnique(families.map(f => f.key), 'family key');
for (const language of ['en', 'id', 'uz']) {
  for (const row of rows) {
    if (!row.labels[language] || row.labels[language].length > 120) throw new Error(`Missing or excessive ${language} label: ${row.key}`);
    if (/[\u0000-\u001f\ufffd]/.test(row.labels[language])) throw new Error(`Invalid characters: ${row.key}`);
  }
  assertUnique(rows.map(r => normalise(r.labels[language])), `normalised ${language} labels`);
}
for (const row of rows) {
  if (!families.some(f => f.key === row.reviewFamily)) throw new Error(`Unknown family: ${row.reviewFamily}`);
  if (row.sourceRefs.some(id => !sourceIds.has(id))) throw new Error(`Unknown source: ${row.key}`);
}
const familyCounts = families.map(f => ({ ...f, count: rows.filter(r => r.reviewFamily === f.key).length }));
const majorGroups = [...new Set(rows.filter(r => r.isco08.code).map(r => r.isco08.code[0]))].sort();
const coverage = {
  rows: rows.length,
  languages: ['id', 'uz', 'en'],
  languageLabelCount: rows.length * 3,
  escoPreferredLabelRows: rows.filter(r => r.sourceKind === 'esco').length,
  marketExtensionRows: rows.filter(r => r.sourceKind === 'market_extension').length,
  reviewFamilies: families.length,
  distinctIsco08UnitGroups: new Set(rows.filter(r => r.isco08.code).map(r => r.isco08.code)).size,
  iscoMajorGroupsCovered: majorGroups,
  localLabelsNeedingReview: rows.length * 2,
  readyForImportRows: 0,
  familyCounts,
};
const dataset = {
  datasetId: 'talentio-job-titles-initial-research-2026-10-23',
  version: 'draft-1',
  researchedOn: '2026-10-23',
  status: 'research_draft_not_imported',
  attribution: 'Contains selected occupation identities, English labels, and classification codes from European Commission ESCO v1.2.1. Selection, Indonesian labels, Uzbek labels, and market extensions are editorial adaptations. No Commission endorsement is implied.',
  reuseReference: 'https://esco.ec.europa.eu/en/use-esco/download/privacy-statement',
  coverage,
  reviewFamilies: families,
  sources: sourceRegistry,
  rows,
};
await fs.writeFile(path.join(root, 'job-titles-draft.json'), JSON.stringify(dataset, null, 2) + '\n');
await fs.writeFile(path.join(root, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tableRows = rows.map((r, i) => {
  const fam = families.find(f => f.key === r.reviewFamily);
  const detail = r.sourceKind === 'esco'
    ? `ESCO ${r.esco.code} · ISCO-08 ${r.isco08.code}`
    : 'Istilah pasar · hubungan klasifikasi perlu review';
  return `<tr data-family="${escapeHtml(r.reviewFamily)}" data-kind="${r.sourceKind}" data-search="${escapeHtml(normalise([r.labels.id, r.labels.uz, r.labels.en, fam.nameId, r.esco?.code || ''].join(' ')))}"><td class="number">${i + 1}</td><td><strong lang="id">${escapeHtml(r.labels.id)}</strong><small>${escapeHtml(fam.nameId)}</small></td><td lang="uz">${escapeHtml(r.labels.uz)}</td><td lang="en">${escapeHtml(r.labels.en)}</td><td><details><summary>${r.sourceKind === 'esco' ? 'ESCO' : 'Istilah pasar'}</summary><p>${escapeHtml(detail)}</p><a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">Buka sumber ↗</a>${r.observedTitle ? `<p>Teramati: ${escapeHtml(r.observedTitle)}</p>` : ''}<p>Nama lokal: draf. ${escapeHtml(r.notes)}</p>${r.relatedEsco ? `<p>Terkait secara usulan: ${escapeHtml(r.relatedEsco.preferredLabelEn)}. Belum ditetapkan sebagai sinonim.</p>` : ''}</details></td></tr>`;
}).join('\n');
const sourceLinks = sourceRegistry.map(s => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a><p>${escapeHtml(s.use)}</p></li>`).join('');
const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Job Talentio · Riset katalog jabatan awal</title>
<style>
:root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#172341;background:#f5f6fb;font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:40px 28px 72px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.brand{color:#5636df;font-weight:800;letter-spacing:-.04em;font-size:22px}.date{color:#59647b;font-size:14px}h1{font-size:36px;letter-spacing:-.04em;margin:16px 0 12px}h2{font-size:22px}p{line-height:1.65;margin:8px 0;color:#4f5d78}.intro{max-width:900px}.tag{font-size:12px;font-weight:700;background:#ece8ff;color:#5134bd;border-radius:20px;padding:8px 12px;white-space:nowrap}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.stat{background:white;border:1px solid #e1e5f0;padding:18px 22px;border-radius:12px}.stat b{display:block;font-size:28px;color:#291966}.stat span{font-size:14px;color:#59647b}.notice{padding:16px 20px;background:#fff8e9;border:1px solid #eedcaf;border-radius:12px;line-height:1.65;color:#6c4f1d}.toolbar{display:flex;gap:12px;flex-wrap:wrap;padding:22px 0 14px;position:sticky;top:0;background:#f5f6fb;z-index:2}input,select,button{font:inherit;border:1px solid #cbd3e5;border-radius:8px;padding:12px 14px;color:#172341;background:#fff}input{min-width:280px;flex:1}select{max-width:420px}button{cursor:pointer;font-weight:600}button:hover{background:#eeebff}input:focus,select:focus,button:focus{outline:2px solid #7758f6;outline-offset:2px}.result{font-size:14px;color:#56637c;margin-bottom:12px}.table-wrap{background:white;border:1px solid #dde3ef;border-radius:12px;overflow:auto}table{border-collapse:collapse;width:100%;min-width:1000px;table-layout:fixed}th{text-align:left;background:#f8f9fd;color:#55617b;font-size:12px;text-transform:uppercase;letter-spacing:.04em}td,th{padding:16px;border-bottom:1px solid #e9edf5;vertical-align:top}th:nth-child(1){width:5%}th:nth-child(2){width:29%}th:nth-child(3){width:27%}th:nth-child(4){width:24%}th:nth-child(5){width:15%}td{font-size:14px;line-height:1.5;overflow-wrap:anywhere}tr:last-child td{border-bottom:0}tbody tr:hover{background:#fcfbff}td small{display:block;color:#66748d;font-size:12px;margin-top:7px}.number{color:#788299;font-size:12px}a{color:#5034c6;text-underline-offset:3px}summary{color:#5134bd;cursor:pointer;font-size:12px;font-weight:600}details p{font-size:12px}details a{font-size:12px}.bottom{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-top:18px}.empty{display:none;padding:36px;text-align:center}.research{margin-top:32px;padding:22px 26px;background:white;border:1px solid #dde3ef;border-radius:12px}.research>summary{font-size:18px}.research li{margin:18px 0}.research li p{max-width:1000px}.research p{font-size:14px}.footnote{font-size:12px;color:#69758c;margin-top:24px} [hidden]{display:none!important}@media(max-width:700px){main{padding:22px 14px}h1{font-size:29px}.stats{grid-template-columns:repeat(2,1fr)}.stat{padding:14px}.toolbar{position:static}input,select{width:100%;max-width:none}.bottom{align-items:flex-start;flex-direction:column}.tag{white-space:normal}header{gap:8px}}
</style></head><body><main>
<header><div><div class="brand">Job Talentio</div><div class="date">Riset katalog jabatan · 23 Oktober 2026</div></div><span class="tag">Draf untuk review · belum diimpor</span></header>
<h1>Katalog jabatan awal, tiga bahasa.</h1><p class="intro">${rows.length} calon jabatan lintas ${families.length} bidang untuk fondasi katalog aplikasi. Cari dalam bahasa Indonesia, Uzbek, atau Inggris. Buka sumber setiap baris untuk melihat asal nama dan catatan peninjauan.</p>
<div class="stats"><div class="stat"><b>${rows.length}</b><span>calon jabatan</span></div><div class="stat"><b>${families.length}</b><span>bidang untuk review</span></div><div class="stat"><b>3</b><span>bahasa per jabatan</span></div><div class="stat"><b>${coverage.escoPreferredLabelRows} + ${coverage.marketExtensionRows}</b><span>entri ESCO + istilah pasar</span></div></div>
<div class="notice"><strong>Nama Indonesia dan Uzbek masih draf editorial.</strong> Nama tersebut belum diklaim sebagai terjemahan resmi KBJI/MMK atau hasil review penutur asli. Kode nasional belum dipetakan. Setelah nama dan duplikat ditinjau, entri terpilih dapat diimpor ke database dan dikelola melalui Admin.</div>
<div class="toolbar"><input id="q" type="search" aria-label="Cari jabatan dalam tiga bahasa" placeholder="Cari jabatan… mis. akuntan, buxgalter, accountant"><select id="family" aria-label="Filter bidang"><option value="">Semua bidang (${families.length})</option>${familyCounts.map(f => `<option value="${escapeHtml(f.key)}">${escapeHtml(f.nameId)} (${f.count})</option>`).join('')}</select><select id="kind" aria-label="Filter sumber"><option value="">Semua sumber</option><option value="esco">Label Inggris dari ESCO</option><option value="market_extension">Istilah pasar yang diamati</option></select></div>
<div class="result" id="result" aria-live="polite"></div><div class="table-wrap"><table><thead><tr><th>No.</th><th>Indonesia · draf</th><th>Uzbek · draf</th><th>Inggris</th><th>Sumber</th></tr></thead><tbody>${tableRows}</tbody></table><div class="empty" id="empty">Tidak ada jabatan yang cocok. Coba istilah lain.</div></div>
<div class="bottom"><span class="date" id="pageInfo"></span><div><button id="previous" type="button">← Sebelumnya</button> <button id="next" type="button">Berikutnya →</button></div></div>
<details class="research"><summary>Dasar riset dan sumber</summary><p>ESCO menyediakan identitas dan label Inggris. ISCO adalah kerangka kelompok pekerjaan. KBJI 2026 dan MMK-2025 diverifikasi sebagai acuan nasional terkini; daftar ini belum merupakan crosswalk resmi ke keduanya. Pengamatan lowongan digunakan untuk istilah dan cakupan, bukan untuk menghitung popularitas atau jumlah lowongan.</p><ol>${sourceLinks}</ol><p>Bidang di halaman ini merupakan pengelompokan editorial untuk memudahkan review. Pengelompokan tersebut belum menjadi kategori lowongan atau industri di aplikasi.</p></details>
<p class="footnote">Sumber identitas/label Inggris: European Commission, ESCO v1.2.1. Pemilihan entri, terjemahan Indonesia/Uzbek, dan istilah pasar merupakan adaptasi editorial. Riset ini tidak menyatakan dukungan Komisi Eropa. Data aplikasi dan database belum diubah.</p>
</main><script>
const all = Array.from(document.querySelectorAll('tbody tr'));
const q = document.getElementById('q'), family = document.getElementById('family'), kind = document.getElementById('kind');
const pageSize=50;let page=0;
const normalise=s=>s.normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^\\p{L}\\p{N}]/gu,'');
function render(reset=false){if(reset)page=0;const needle=normalise(q.value);const filtered=all.filter(r=>(!needle||r.dataset.search.includes(needle))&&(!family.value||r.dataset.family===family.value)&&(!kind.value||r.dataset.kind===kind.value));const pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages-1);const showing=new Set(filtered.slice(page*pageSize,(page+1)*pageSize));all.forEach(r=>r.hidden=!showing.has(r));document.getElementById('result').textContent=filtered.length+' dari '+all.length+' jabatan cocok';document.getElementById('pageInfo').textContent='Halaman '+(page+1)+' dari '+pages;document.getElementById('previous').disabled=page===0;document.getElementById('next').disabled=page>=pages-1;document.getElementById('empty').style.display=filtered.length?'none':'block';}
q.addEventListener('input',()=>render(true));family.addEventListener('change',()=>render(true));kind.addEventListener('change',()=>render(true));document.getElementById('previous').addEventListener('click',()=>{page--;render();});document.getElementById('next').addEventListener('click',()=>{page++;render();});render();
</script></body></html>`;
await fs.writeFile(path.join(root, 'review.html'), html);

let markdown = '# Daftar awal jabatan Job Talentio\n\nTanggal riset: 23 Oktober 2026. Status: draf untuk review; belum diimpor ke database.\n\n';
markdown += `${rows.length} calon jabatan, ${families.length} bidang editorial, dan tiga bahasa. Nama Inggris pada ${coverage.escoPreferredLabelRows} baris berasal dari ESCO v1.2.1; ${coverage.marketExtensionRows} baris merupakan istilah pasar dengan sumber pemberi kerja. Semua nama Indonesia dan Uzbek merupakan draf editorial yang memerlukan review.\n\n`;
markdown += 'Kode ISCO-08 pada entri ESCO adalah kode kelompok dari sumber, bukan kode jabatan nasional. KBJI 2026 dan MMK-2025 belum dipetakan per entri. Lihat README.md dan sources.json untuk metode serta batas riset.\n\n';
for (const f of families) {
  markdown += `## ${f.nameId}\n\n| Indonesia (draf) | Uzbek (draf) | Inggris | Sumber |\n|---|---|---|---|\n`;
  for (const row of rows.filter(r => r.reviewFamily === f.key)) {
    markdown += `| ${row.labels.id} | ${row.labels.uz} | ${row.labels.en} | [${row.sourceKind === 'esco' ? `ESCO ${row.esco.code}` : 'Istilah pasar'}](${row.sourceUrl}) |\n`;
  }
  markdown += '\n';
}
await fs.writeFile(path.join(root, 'daftar-jabatan.md'), markdown);
const checksumFiles = ['draft-labels.txt', 'market-extensions.json', 'sources.json', 'job-titles-draft.json', 'coverage.json', 'review.html', 'daftar-jabatan.md', ...[0,1,2,3].map(i => `sources/esco-occupations-page-${i}.json`)];
const checksums = await Promise.all(checksumFiles.map(async file => ({ file, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })));
await fs.writeFile(path.join(root, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');
console.log(JSON.stringify(coverage, null, 2));
