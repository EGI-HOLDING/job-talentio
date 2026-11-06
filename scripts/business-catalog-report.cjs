const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../output/business-catalog');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json'),'utf8'));
const baseline=read('baseline'),after=read('after'),matchingBefore=read('matching-baseline'),matchingAfter=read('matching-after');
if(JSON.stringify(baseline.tables)!==JSON.stringify(after.tables))throw Error('Historical data differs from baseline');
if(matchingBefore.hash!==matchingAfter.hash)throw Error('Legacy ranking differs from baseline');
const unit=read('unit'),integration=read('integration'),concurrency=read('concurrency'),performance=read('performance'),backfill=read('backfill-applied'),inventory=read('industry-source-inventory');
const evidence=read('evidence-preservation');
if(!evidence.preserved)throw Error('CV/profile/source evidence preservation failed');
if(!performance.production||performance.rows.some(row=>!row.passes))throw Error('Production performance verification is incomplete');
const text=[
 '# Backend katalog industri dan senioritas — laporan lokal',
 '',`Baseline kode: ${baseline.revision}. Database uji: ${baseline.database}.`,
 '', '## Hasil implementasi',
 '- 29 group industri berversi, label empat bahasa, definisi dan batas cakupan. Empat group lama serta 37 ID industri lama tetap utuh.',
 `- ${backfill.industries.filter(row=>row.state==='MAPPED').length} industri dipetakan dengan pasti; ${backfill.industries.filter(row=>row.state==='REVIEW_REQUIRED').length} label gabungan/umum dilaporkan tanpa tebakan. Tidak memblokir perusahaan lama.`,
 '- 14 level senioritas dengan snapshot rentang otomatis; batas atas null untuk 20+. Field pengalaman lama tetap tersimpan dan evaluator HR tidak diubah.',
 '- Kandidat memakai batas bawah sebagai acuan ranking, bukan gate wajib. Pengalaman berlebih tidak dihukum; bukti belum tersedia tetap UNKNOWN.',
 `- Inventaris sumber: ${inventory.counts.entries} entri kandidat, ${inventory.counts.distinctLabels} label berbeda secara teks. Ini bukan jumlah industri kanonis; tidak ada bulk import ke katalog aktif.`,
 '', '## Kontrak API',
 '- GET /api/meta/industry-groups → {version, groups}. GET /api/meta/seniority-levels → {version, levels}.',
 '- Company/onboarding menerima industryGroupCode, detail industrySlug opsional. Detail dikosongkan dengan string kosong; group dikosongkan dengan null. Pasangan bertentangan ditolak atomik.',
 '- Directory menerima industryGroupCode; item menambahkan industryGroupId yang dapat dicocokkan dengan metadata. Profil perusahaan memuat objek industryGroup.',
 '- Job POST/PATCH menerima seniorityLevelCode; snapshot seniorityVersion/seniorityYearsMin/seniorityYearsMax hanya ditetapkan server. null menghapus snapshot. Angka pengalaman tidak dapat dioverride saat level baru dipakai.',
 '- Job search menambahkan filter industryGroupCode serta facets.industryGroups. Filter group/detail beririsan dan tidak membuka identitas employer anonim.',
 '- MatchInsights memuat experiencePolicyVersion dan evidence.experienceReference untuk membedakan acuan katalog dan persyaratan employer.',
 '', '## Verifikasi',
 `- Unit: ${unit.assertions} pemeriksaan; integrasi database/HTTP/JWT/Redis: ${integration.assertions}; concurrency: ${concurrency.assertions}.`,
 '- Seluruh fixture integrasi di-rollback. Fixture concurrency dihapus setelah tes. Checksum sembilan tabel baseline tetap sama; 16 tabel CV/profil/alias/relasi juga identik dengan sumber salinan lokal.',
 `- Mode lama identik: ${matchingBefore.profiles} profil × ${matchingBefore.jobs} lowongan, hash ${matchingBefore.hash}.`,
 '- Regresi API utama, HR v2, negara/gaji, sumber ESCO, dan relasi profesi dijalankan. Hasil review manusia tidak diklaim atau digunakan sebagai gate.',
 '', '## Performa production build',
 performance.method,
 '', '| Layanan | Baseline p95 | Baru p95 | Perubahan |',
 '|---|---:|---:|---:|',
 ...performance.rows.map(row=>`| ${row.name} | ${row.baselineP95Ms.toFixed(2)} ms | ${row.currentP95Ms.toFixed(2)} ms | ${row.regressionPercent.toFixed(1)}% |`),
 '', 'Angka adalah waktu layanan lokal, tidak termasuk HTTP/browser, dan bukan pengukuran VPS. Tidak ada klaim kualitas ranking manusia baru dari pengujian ini.',
 '', '## Menjalankan ulang (dari root repository)',
 '```powershell',
 'node scripts/business-catalog-local.cjs --clone',
 'node scripts/business-catalog-migration.cjs --dry-run',
 'node scripts/business-catalog-migration.cjs',
 'node scripts/business-catalog-run.cjs apps/api/src/scripts/business-catalog.ts',
 'node scripts/business-catalog-run.cjs apps/api/src/scripts/business-catalog.ts --apply',
 'node scripts/business-catalog-run.cjs apps/api/src/catalogs/business-catalog.smoke.ts',
 'node scripts/business-catalog-run.cjs apps/api/src/catalogs/business-catalog.integration.ts',
 'node scripts/business-catalog-run.cjs apps/api/src/catalogs/business-catalog.concurrency.ts',
 '```',
 '', '## Aktivasi dan pemulihan',
 '- Runner lokal mengaktifkan EMPLOYEE_EXPERIENCE_POLICY_ENABLED=true pada database uji terisolasi. Tidak mengubah .env/database utama atau proses milik pekerjaan lain.',
 '- Untuk backend yang nanti dirilis, migrasi dan pengisian katalog harus dijalankan lebih dahulu; flag diaktifkan secara eksplisit. Katalog tidak di-seed saat startup.',
 '- Pemulihan ranking: EMPLOYEE_EXPERIENCE_POLICY_ENABLED=false. Snapshot baru tetap tersimpan; resolver posisi, relasi profesi, negara/gaji dan pemisahan eksplorasi tetap dipertahankan.',
 '- Versi senioritas baru tidak menimpa snapshot lama. Taksonomi dan level yang dirujuk dilindungi foreign key dan validasi database.',
 '- UI/UX, HR matching, commit, push, VPS dan Railway tidak diubah pada pekerjaan ini.',
 '', '## Batas yang disengaja',
 '- Tidak menyimpulkan salah satu dari 14 level dari enam enum lama atau tahun pengalaman saja. Backfill senioritas historis nol, karena tidak ada bukti padanan tunggal.',
 '- Parser CV dan resolver profesi tidak dirombak. Katalog industri tidak menambahkan filter/bobot matching otomatis.',
 '- Rilis VPS berikutnya tetap memerlukan dry run pada inventori produksi saat itu; semua hasil laporan ini berasal dari salinan lokal yang dikunci.',
 ];
fs.writeFileSync(path.join(dir,'REPORT.md'),text.join('\n')+'\n');console.log(path.join(dir,'REPORT.md'));
