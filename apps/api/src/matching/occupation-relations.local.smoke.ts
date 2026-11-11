import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { buildProfessionGraph } from './occupation-relations';
import { loadProfessionSource } from './occupation-relations.service';
import { indonesiaProfessionDefinitions, professionWorkScopes } from './indonesia-profession-definitions';
import type { IntentRole } from './employee-occupation';

const directory = path.resolve(__dirname, '../../prisma/data');
const source = loadProfessionSource();
const audit = JSON.parse(fs.readFileSync(path.join(directory, 'job-titles/audit-2026-10-24.json'), 'utf8').replace(/^\uFEFF/, ''));
const officialFamilies = new Map<string, string>(audit.rows.filter((row: any) => row.source?.uri?.startsWith('http://data.europa.eu/esco/occupation/') && row.source?.isco08).map((row: any) => [row.source.uri, row.source.isco08.slice(0, 3)]));
const roles = new Map<string, IntentRole>();

function role(name: string, familyId: string, uri?: string) {
  const id = catalogTitleIdentityKey(name);
  roles.set(id, { id, name, familyId, matchingApproved: true, aliases: [], canonicalRoleId: null,
    family: { id: familyId, name: familyId, archivedAt: null }, matchingMetadata: uri ? { sources: [{ uri }] } : {} });
}
for (const occupation of source.occupations) {
  const family = officialFamilies.get(occupation.uri);
  if (family) role(occupation.label, family, occupation.uri);
}
for (const definition of indonesiaProfessionDefinitions) {
  const reference = source.occupations.find(occupation => occupation.label === definition.referenceOccupation);
  assert.ok(reference);
  for (const title of definition.titles) role(title, officialFamilies.get(reference.uri) ?? 'local');
}
for (const name of ['Koki Dapur Dingin','Koki Dapur Panas','Koki Salad dan Hidangan Dingin','Koki Persiapan Dapur Panas','Commis Menu Nusantara','Koki Spesialis Menu Nusantara']) {
  assert.equal(roles.get(catalogTitleIdentityKey(name))?.familyId, '512');
}

const graph = buildProfessionGraph([...roles.values()], { ...source, localDefinitions: indonesiaProfessionDefinitions, workScopes: professionWorkScopes });
const related = new Set(graph.relations.filter(edge => edge.basis.kind === 'RELATED').map(edge => edge.fromRoleId + '|' + edge.toRoleId));
const decisions = new Map(graph.relations.map(edge => [edge.fromRoleId+'|'+edge.toRoleId,edge.basis]));
const cases: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
  ['Chef', [
    'Koki Persiapan Dapur Panas', 'Koki Dapur Panas', 'Sous Chef Dapur Panas',
    'Koki Salad dan Hidangan Dingin', 'Koki Dapur Dingin', 'Kepala Dapur Dingin',
    'Commis Menu Nusantara', 'Koki Spesialis Menu Nusantara', 'Chef Pengembangan Menu Lokal',
    'Supervisor Produksi Dapur', 'Chef Pastry Restoran',
  ], ['Restaurant Manager', 'Baker dan Pengembang Pastry', 'Operator Lini Produk Siap Masak', 'Steward Restoran', 'Petugas Penerimaan Bahan Dapur']],
  ['Backend Developer', ['Full-stack Developer', 'Java Developer', 'Python Developer'], ['Frontend Developer', 'Mobile Application Developer', 'Prompt Engineer', 'QA Engineer', 'Site Reliability Engineer']],
  ['Frontend Developer', ['Full-stack Developer', 'React Developer'], ['Backend Developer', 'Cloud Engineer']],
  ['Mechanical Engineer', ['Mechanical Design Engineer'], ['Teknisi Listrik dan Panel Produksi', 'Food Production Planner']],
  ['Nurse Responsible for General Care', ['Registered Nurse', 'Perawat Koordinator Klinik'], ['Petugas Layanan Pasien', 'Pharmacist']],
  ['Cardiologist', ['Interventional Cardiologist'], ['Cardiac Surgeon', 'Radiologist']],
  ['Primary School Teacher', ['Pendidik Anak Usia Dini'], ['English Teacher (Corporate)', 'Konselor Penerimaan Siswa']],
  ['Tourist Guide', ['Asisten Pemandu Wisata', 'Pemandu Edukasi Lingkungan'], ['Manajer Produk Wisata', 'Pengemudi Antar-Jemput Tamu']],
  ['Inventory Coordinator', ['Pengendali Persediaan Pangan', 'Pengendali Stok Dapur'], ['Koordinator Pengadaan Outlet', 'Chef Pengembangan Menu Lokal']],
  ['Purchaser', ['Buyer Bahan Pangan', 'Pembeli Bahan Segar dan Lokal'], ['Supervisor Gudang Pangan', 'Teknisi Pemeliharaan']],
  ['Customer Service Representative', ['Petugas Layanan Pasien', 'Spesialis Layanan Konsumen Pangan'], ['Apoteker Penanggung Jawab', 'Perawat Koordinator Klinik']],
  ['Food Analyst', ['Analis Laboratorium Pangan', 'Analis Evaluasi Sensoris Produk'], ['Operator Lini Produk Siap Masak', 'Koki Dapur Dingin']],
  ['Industrial Pharmacist', ['Apoteker Produksi'], ['Analis Laboratorium Pangan', 'Petugas Layanan Pasien']],
  ['Solar Energy Engineer', ['Insinyur Proyek Tenaga Surya'], ['Petugas Program Energi Komunitas', 'Petugas Pemantau Cuaca dan Rencana Alternatif']],
  ['Credit Analyst', ['Analis Kredit Komersial'], ['Manajer Relasi Usaha Kecil', 'Perencana Permintaan Distribusi']],
  ['Travel Agent', ['Admin Reservasi Tur', 'Spesialis Reservasi dan Tiket'], ['Asisten Pemandu Wisata', 'Pengelola Informasi Destinasi']],
  ['Restaurant Host/restaurant Hostess', ['Host Restoran', 'Kapten Reservasi dan Host'], ['Koordinator Layanan Meja', 'Koki Dapur Dingin']],
  ['Industrial Machinery Mechanic', ['Teknisi Perawatan Mesin Pangan', 'Mekanik Mesin Produksi'], ['Formulator Produk Pangan', 'Petugas Gudang Bahan Pangan']],
  ['Food Safety Specialist', ['Auditor Internal Kebersihan Pangan', 'Spesialis Kepatuhan Keamanan Pangan'], ['Koki Dapur Panas', 'Koordinator Pengadaan Pangan']],
  ['Agronomist', ['Agronom Lapangan', 'Agronom Tanaman Perkebunan'], ['Koordinator Pengadaan Bahan Baku', 'Supervisor Gudang Distribusi']],
  ['Sales Account Manager', ['Eksekutif Akun Pelanggan', 'Pengelola Akun Food Service'], ['Petugas Pengiriman Akun Kuliner', 'Inspektur Mutu Komponen']],
  ['Pharmacist', ['Apoteker Penanggung Jawab'], ['Perawat Koordinator Klinik', 'Spesialis Layanan Konsumen Pangan']],
  ['Ship Captain', ['Nakhoda Kapal Wisata'], ['Asisten Pemandu Snorkeling', 'Petugas Perlengkapan Aktivitas Bahari']],
  ['Packaging and Filling Machine Operator', ['Teknisi Pengemasan Pangan', 'Teknisi Set-up Mesin Pengemasan'], ['Spesialis Label Produk Pangan', 'Inspektur Mutu Bahan Masuk']],
  ['Barista', ['Kepala Bar Kopi'], ['Koordinator Kasir Outlet', 'Koordinator Layanan Meja']],
  ['Product Quality Inspector', ['Inspektur Mutu Komponen', 'Penilai Mutu Produk Kriya'], ['Eksekutif Penjualan Armada', 'Koordinator Layanan Acara']],
  ['Pediatrician', [], ['Pediatric Surgeon', 'Geriatrician', 'Pendidik Anak Usia Dini']],
];
let positive = 0, negative = 0;
const failures: string[] = [];
for (const [from, include, exclude] of cases) {
  for (const [expected, targets] of [[true, include], [false, exclude]] as const) {
    for (const to of targets) {
      const fromId = catalogTitleIdentityKey(from), toId = catalogTitleIdentityKey(to);
      assert.ok(roles.has(fromId) && roles.has(toId), 'Benchmark role unavailable: '+from+' / '+to);
      if (related.has(fromId + '|' + toId) !== expected) {
        const basis=decisions.get(fromId+'|'+toId);
        failures.push((expected ? 'Missing ' : 'Leaked ') + from + ' → ' + to + (basis ? ' ['+basis.sharedEssentialSkills.map(t=>t.label).join(', ')+']' : ' [no shared core tasks]'));
      }
      else if (expected) positive++;
      else negative++;
    }
  }
}
assert.equal(graph.report.sourceMissing.length, 0, 'Each benchmark profession has documented evidence');
console.log(JSON.stringify({ suite:'indonesia-profession-relations', profiles:graph.report.profilesAvailable, localProfiles:graph.report.localTaskProfiles, scenarios:cases.length, positive, negative, failures }));
assert.deepEqual(failures, []);
