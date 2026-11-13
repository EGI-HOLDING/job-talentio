// Creates synthetic cases and locks their expected grades before any provider call.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const api = createRequire(resolve('apps/api/package.json'));
const PDFDocument = api('pdfkit');

const roles = [
  { title: 'Presales Engineer', tasks: [
    { duty: 'Gali kebutuhan dan batasan teknis pelanggan', cv: 'Menggali beban puncak, kebutuhan audit dan batas integrasi. Mencatat kriteria penerimaan bersama pelanggan.',
      answer: 'Gue mulai dari beban puncak, batas integrasi dan audit. Gue konfirmasi mana yang wajib, lalu minta persetujuan tertulis atas kriteria penerimaan supaya demo bisa diverifikasi.' },
    { duty: 'Siapkan demo solusi yang dapat diverifikasi', cv: 'Membuat demo dengan data sintetis dan menguji dua skenario kegagalan sebelum demo pelanggan.',
      answer: 'Gue bikin data sintetis dengan bentuk yang sama. Gue uji alur normal dan saat integrasi gagal, lalu simpan hasil tiap skenario supaya pelanggan bisa mengulangi tes.' },
  ] },
  { title: 'Backend Engineer', tasks: [
    { duty: 'Bangun endpoint yang memvalidasi dan melindungi data pelanggan', cv: 'Menulis endpoint dengan validasi skema, pembatasan tenant dan tes lintas tenant.',
      answer: 'Gue validasi skema di boundary, lalu pakai tenant dari sesi server pada setiap query. Gue tulis tes akses silang supaya ID yang valid di tenant lain tetap ditolak.' },
    { duty: 'Migrasikan skema tanpa mengganggu pengguna', cv: 'Menjalankan migrasi aditif, backfill batch idempoten, dan rekonsiliasi sebelum perpindahan pembacaan.',
      answer: 'Gue tambah kolom kompatibel dulu, backfill batch dengan cursor yang bisa diulang, lalu cocokkan hitungan dan sampel. Gue geser jalur baca setelah lolos dan siap balik ke pembacaan lama.' },
  ] },
  { title: 'Graphic Designer', tasks: [
    { duty: 'Rancang materi kampanye dengan hierarki visual yang jelas', cv: 'Merancang materi kampanye multiukuran, menyusun hierarki tipografi dan menguji keterbacaan pada ukuran terkecil.',
      answer: 'Gue pilih pesan utama dari brief, atur skala judul dan kontras, lalu uji di ukuran ponsel terkecil. Gue besarkan informasi wajib ketika keterbacaan versi pertama kurang.' },
    { duty: 'Siapkan berkas cetak sesuai spesifikasi produksi', cv: 'Menyiapkan CMYK, bleed dan font pada PDF cetak serta memeriksa proof sebelum produksi.',
      answer: 'Gue cek profil warna dan bleed sesuai spek vendor, sematkan font, lalu minta proof. Gue cocokkan margin potong dan perbedaan warna sebelum memberi persetujuan cetak.' },
  ] },
  { title: 'Accounting Staff', tasks: [
    { duty: 'Rekonsiliasi transaksi bank dengan buku besar', cv: 'Mencocokkan mutasi bank dan buku besar serta memisahkan transaksi belum tercatat dari selisih waktu.',
      answer: 'Gue cocokkan referensi, tanggal, dan nominal. Selisih waktu gue tandai terpisah, lalu gue telusuri sisa selisih ke bukti transaksi dan rekonsiliasi ulang setelah jurnal disetujui.' },
    { duty: 'Dokumentasikan selisih sebelum tutup buku', cv: 'Menyusun daftar selisih, bukti pendukung, pemilik tindak lanjut dan persetujuan jurnal sebelum penutupan.',
      answer: 'Gue simpan daftar umur selisih, sumber, dan penanggung jawab. Gue minta review jurnal koreksi, lalu catat item terbuka agar pemeriksa bisa menelusuri saldo setelah tutup buku.' },
  ] },
  { title: 'Chef', tasks: [
    { duty: 'Jaga keamanan pangan dalam persiapan dan penyajian', cv: 'Memisahkan bahan mentah dan siap saji, memantau suhu serta mencatat tindakan koreksi.',
      answer: 'Gue pisahkan alat untuk bahan mentah, cek suhu dengan termometer terkalibrasi, dan tahan batch yang di luar batas. Gue catat tindakan koreksinya sebelum batch boleh disajikan.' },
    { duty: 'Atur produksi masakan untuk beberapa batch', cv: 'Menskala resep, merencanakan batch berdasarkan kapasitas alat dan memeriksa mutu tiap batch.',
      answer: 'Gue hitung porsi dari resep dasar, cek kapasitas oven dan urutkan batch. Gue cek rasa dan tekstur batch pertama supaya penyesuaian bisa dicatat sebelum batch berikutnya.' },
  ] },
  { title: 'Logistics Coordinator', tasks: [
    { duty: 'Tangani pengecualian pada pengiriman', cv: 'Memverifikasi pengiriman tertunda melalui scan terakhir, menyusun opsi pengiriman ulang dan mengabari penerima.',
      answer: 'Gue cek scan terakhir dan cutoff. Kalau kendaraan gagal, gue bandingkan pengiriman ulang dan pengalihan rute terhadap SLA, lalu kasih ETA yang sudah dikonfirmasi ke penerima.' },
    { duty: 'Rekonsiliasi stok fisik dengan sistem gudang', cv: 'Memimpin hitung ulang SKU selisih, menelusuri dokumen perpindahan dan merekam persetujuan penyesuaian.',
      answer: 'Gue bekukan perpindahan pada zona yang dihitung, minta recount dengan petugas berbeda, lalu cocokkan scan penerimaan dan transfer. Perubahan saldo baru gue kirim untuk persetujuan.' },
  ] },
];

const partialActions = [
  'Saya akan membuat data sintetis untuk demo. Saya belum tahu cara memverifikasi hasilnya.',
  'Saya akan menambah kolom baru. Saya belum tahu cara melakukan backfill atau memeriksa dampaknya.',
  'Saya akan menambahkan bleed pada PDF. Saya belum tahu cara memeriksa warna dan proof.',
  'Saya akan membuat daftar selisih. Saya belum tahu bukti yang perlu dilampirkan untuk tutup buku.',
  'Saya akan menghitung kebutuhan porsi dari resep. Saya belum tahu cara mengatur kapasitas alat atau memeriksa hasil tiap batch.',
  'Saya akan menghitung ulang stok fisik. Saya belum tahu bagaimana menelusuri selisih transaksi.',
];

const expected = [
  { cv: [3, 3], competency: [4, 4], explanation: [4, 4] },
  { cv: [3, 0], competency: [4, 2], explanation: [4, 2] },
  { cv: [1, 1], competency: [0, 4], explanation: [0, 4] },
  { cv: [0, 0], competency: [4, 4], explanation: [4, 4] },
  { cv: [0, 0], competency: [0, 0], explanation: [0, 0] },
];

function makeCases() {
  return roles.flatMap((role, i) => {
    const [a, b] = role.tasks;
    const profiles = [
      { cv: [a.cv, b.cv], answers: [a.answer, b.answer] },
      { cv: [a.cv, 'Menyusun jadwal rapat tim.'], answers: [a.answer, partialActions[i]] },
      { cv: ['Ringkasan keahlian tanpa contoh proyek — ' + a.duty, 'Ringkasan keahlian tanpa contoh proyek — ' + b.duty],
        answers: ['Saya ikut diskusi sebagai pengamat. Saya tidak bisa menjelaskan bagaimana mengerjakan tugas itu.', b.answer] },
      { cv: ['Proyek kelas selama enam bulan.', 'Membantu dosen menyiapkan materi praktikum.'],
        answers: [a.answer.replace('Gue ', 'Pada proyek kelas saya '), b.answer.replace('Gue ', 'Kalau diminta, saya ')] },
      { cv: ['Merapikan ruang rapat.', 'Mengelola jadwal pribadi.'],
        answers: ['Saya belum bisa menjelaskan langkah yang relevan untuk tugas ini.', 'Saya belum punya cara yang bisa saya jelaskan sekarang.'] },
    ];
    return profiles.map((profile, j) => ({ id: `R${i + 1}-${j + 1}`, role: role.title, responsibilities: role.tasks.map(task => task.duty),
      layout: j % 2 ? 'two-columns' : 'one-column', cv: profile.cv,
      interview: role.tasks.map((task, k) => ({ question: `Gimana cara lu mengerjakan tugas berikut?\n${task.duty}`,
        answer: profile.answers[k], opportunity: 'ANSWERED' })) }));
  });
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function cvPdf(row, file) {
  const doc = new PDFDocument({ info: { Title: row.id, CreationDate: new Date('2026-01-01T00:00:00Z') } });
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => { const data = Buffer.concat(chunks); writeFileSync(file, data); resolve(sha256(data)); });
    doc.fontSize(22).text(`Kandidat sintetis ${row.id}`);
    doc.moveDown().fontSize(14).text('Pengalaman dan keahlian');
    const y = doc.y + 12;
    doc.fontSize(12).text(row.cv[0], 72, y, { width: row.layout === 'two-columns' ? 210 : 440 });
    doc.text(row.cv[1], row.layout === 'two-columns' ? 320 : 72, row.layout === 'two-columns' ? y : doc.y + 18,
      { width: row.layout === 'two-columns' ? 220 : 440 });
    doc.end();
  });
}

async function generate(output) {
  mkdirSync(join(output, 'cv'), { recursive: true });
  const cases = makeCases();
  for (const row of cases) {
    row.pdf = `cv/${row.id}.pdf`;
    row.pdfChecksum = await cvPdf(row, join(output, row.pdf));
  }
  const grades = cases.map((row, index) => ({ id: row.id, ...expected[index % expected.length] }));
  const manifest = { version: 1, cases, referenceChecksum: sha256(JSON.stringify(grades)) };
  const checksum = sha256(JSON.stringify(manifest));
  writeJson(join(output, 'manifest.json'), { ...manifest, checksum });
  writeJson(join(output, 'reference.json'), { kind: 'PREDEFINED_SYNTHETIC', checksum, grades });
  const instructions = '# Evaluasi sintetis Tara dan Taka\n\n' +
    'Acuan dikunci sebelum pengiriman ke model. Lima kasus per peran mencakup bukti lengkap, jawaban parsial, keahlian yang hanya disebut, bukti dari proyek pendidikan, dan kesempatan menjawab tanpa bukti.\n\n' +
    'Bukti CV memakai skala 0 jika tidak disebut, 1 jika hanya disebut, 2 untuk bukti sebagian, 3 jika memenuhi, dan 4 untuk bukti langsung yang kuat.\n\n' +
    'Kompetensi memakai skala 0 jika kandidat sudah mendapat kesempatan dan belum memberi penerapan relevan, 1 untuk konsep umum, 2 untuk penerapan sebagian, 3 untuk tindakan tepat dengan alasan, dan 4 untuk penerapan kuat termasuk validasi atau risiko.\n\n' +
    'Kejelasan memakai skala 0 hingga 4 berdasarkan seberapa jelas tindakan dan keputusan dapat dipahami. Gunakan bukti aktual dan abaikan gaya bahasa atau panjang jawaban.\n\n';
  const sections = cases.map(row => `## ${row.id} · ${row.role}\n\n[CV sintetis](${row.pdf})\n\n` +
    row.interview.map((turn, i) => `${i + 1}. **${row.responsibilities[i]}**\n\n   ${turn.question.replace('\n', ' ')}\n\n   ${turn.answer}`).join('\n\n'));
  writeFileSync(join(output, 'panduan-review.md'), instructions + sections.join('\n\n') + '\n');
  console.log(JSON.stringify({ cases: cases.length, answers: cases.reduce((sum, row) => sum + row.interview.length, 0), roles: roles.length, checksum, paidCalls: 0 }));
}

function compare(manifestPath, referencePath, predictedPath) {
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const { checksum, ...manifest } = read(manifestPath);
  assert.equal(checksum, sha256(JSON.stringify(manifest)));
  assert.ok(manifest.cases.length >= 30 && new Set(manifest.cases.map(row => row.role)).size >= 6);
  assert.ok(manifest.cases.reduce((sum, row) => sum + row.interview.length, 0) >= 60);
  const reference = read(referencePath), predicted = read(predictedPath);
  assert.equal(reference.kind, 'PREDEFINED_SYNTHETIC');
  assert.equal(sha256(JSON.stringify(reference.grades)), manifest.referenceChecksum);
  const components = ['cv', 'competency', 'explanation'];
  const assessments = [reference, predicted].map(file => {
    assert.equal(file.checksum, checksum);
    assert.equal(file.grades.length, manifest.cases.length);
    const grades = new Map(file.grades.map(row => [row.id, row]));
    assert.equal(grades.size, manifest.cases.length);
    for (const sample of manifest.cases) for (const key of components) {
      const values = grades.get(sample.id)?.[key];
      assert.equal(values?.length, sample.interview.length, sample.id + ' ' + key);
      assert.ok(values.every(level => Number.isInteger(level) && level >= 0 && level <= 4), sample.id + ' ' + key);
    }
    return grades;
  });
  const groups = new Map();
  const total = { within: 0, grades: 0, absError: 0, samples: 0 };
  const value = levels => Math.round(levels.reduce((sum, n) => sum + n, 0) / levels.length * 250) / 10;
  const final = row => Math.round((value(row.cv) * 30 + value(row.competency) * 60 + value(row.explanation) * 10) / 10) / 10;
  for (const sample of manifest.cases) {
    const [target, model] = assessments.map(rows => rows.get(sample.id));
    const group = groups.get(sample.role) || { within: 0, grades: 0, absError: 0, samples: 0 };
    for (const row of [group, total]) {
      row.samples++;
      row.absError += Math.abs(final(target) - final(model));
      for (const key of components) for (const [i, level] of model[key].entries()) {
        row.grades++;
        if (Math.abs(level - target[key][i]) <= 1) row.within++;
      }
    }
    groups.set(sample.role, group);
  }
  const metrics = row => ({ samples: row.samples, grades: row.grades, withinOne: row.within / row.grades, finalMeanAbsoluteError: row.absError / row.samples });
  const result = metrics(total);
  console.log(JSON.stringify({ ...result, roles: Object.fromEntries([...groups].map(([role, group]) => [role, metrics(group)])) }, null, 2));
  assert.ok(result.withinOne >= .95 && result.finalMeanAbsoluteError <= 5, 'Quality gate failed');
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'generate' && args.length === 1) return generate(resolve(args[0]));
  if (mode === 'compare' && args.length === 3) return compare(...args);
  throw new Error('Use generate OUTPUT or compare MANIFEST REFERENCE PREDICTIONS');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
