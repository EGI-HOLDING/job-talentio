import type { EmployeeEligibility } from '@job-talentio/shared';
import { createHash } from 'node:crypto';

export const VACANCY_TASK_VERSION = process.env.EMPLOYEE_VACANCY_TASK_VERSION==='vacancy-tasks-v3'?'vacancy-tasks-v3':'vacancy-tasks-v2';
export const vacancyTaskText=(posting:{description:string;responsibilities?:readonly string[]})=>posting.responsibilities?.length?[posting.description,'Responsibilities',...posting.responsibilities].join('\n'):posting.description;

// Concepts describe work products and responsibility. A domain name or a
// generic capability is insufficient to establish a relation.
const concepts = [
  ['sales.team-targets', 'sales', 'lead', /(?:set|manage|assign|review) (?:\w+ ){0,3}sales (?:goals|targets|quotas)|(?:menetapkan|mengelola|mengulas) (?:\w+ ){0,4}(?:sasaran|target) (?:penjualan|mingguan)|mengelola target penjualan multi.?gerai/iu],
  ['sales.team-coaching', 'sales', 'lead', /(?:supervise|lead|coach|manage) (?:\w+ ){0,3}sales (?:team|activities|staff)|(?:membina|melatih|mendampingi) (?:tim penjualan|kepala toko|supervisor penjualan)|memimpin tim (?:sales|penjualan)/iu],
  ['sales.customer-needs', 'sales', 'individual', /perform customers.? needs analysis|(?:memetakan|menggali) kebutuhan (?:pelanggan|armada|produk)|prospect new customers|mencari calon pelanggan/iu],
  ['sales.contracts', 'sales', 'individual', /(?:negotiate sales contracts|negotiate price|manage contracts)|(?:menyusun|menyiapkan) (?:proposal|penawaran)|mengelola proses negosiasi/iu],
  ['sales.order-records', 'sales', 'support', /record sales orders|sales order processing|(?:mencatat|memproses) pesanan penjualan|administrasi pesanan/iu],
  ['marketing.campaigns', 'marketing', 'core', /plan marketing campaigns|plan marketing strategy|(?:merancang|menyusun|menjalankan) kampanye pemasaran/iu],
  ['marketing.audience', 'marketing', 'core', /perform market research|analyse consumer buying trends|(?:riset pasar|analisis perilaku konsumen)/iu],
  ['culinary.prepare', 'food', 'kitchen', /use food preparation techniques|prepare (?:ingredients|cold dishes)|menyiapkan (?:mise en place|sayuran|bahan masakan)|mengolah bumbu dasar/iu],
  ['culinary.cook', 'food', 'kitchen', /use cooking techniques|cook (?:dishes|menu items)|memasak menu/iu],
  ['culinary.finish', 'food', 'kitchen', /use culinary finishing techniques|(?:mengatur|memeriksa) (?:urutan )?(?:plating|rasa, porsi)|memeriksa rasa, tingkat kematangan/iu],
  ['culinary.pastry', 'food', 'kitchen', /cook pastry products|pastry production|menyiapkan adonan|mengoperasikan oven dan peralatan pastry/iu],
  ['food.machine', 'food', 'industrial', /operate (?:food processing|packaging) machinery|(?:mengoperasikan|menyetel) mesin (?:produksi pangan|pengemasan)/iu],
  ['food.batch', 'food', 'industrial', /monitor production batch parameters|(?:memantau|mencatat) parameter (?:proses|produksi) (?:bets|batch)/iu],
  ['food.service', 'food', 'service', /serve food and beverages|mencatat pesanan dan permintaan khusus|melayani pesanan meja/iu],
  ['software.server', 'software', 'server', /(?:develop|implement|build|maintain) (?:\w+ ){0,4}(?:server.side|back.end|backend|REST(?:ful)? APIs?|server APIs?)|(?:membangun|mengembangkan|mengimplementasikan|memelihara) (?:\w+ ){0,3}(?:backend|API REST|logika sisi server|layanan server)/iu],
  ['software.integration', 'software', 'server', /(?:design|develop) (?:\w+ ){0,2}API integrations?|(?:membangun|mengembangkan) integrasi (?:API|layanan backend)/iu],
  ['software.interface', 'software', 'interface', /(?:implement|build|develop) (?:\w+ ){0,4}(?:user interfaces|customer interfaces|frontend|front.end)|(?:membangun|mengembangkan|mengimplementasikan) (?:\w+ ){0,3}(?:frontend|antarmuka pengguna)/iu],
  ['software.ui-components', 'software', 'interface', /reusable interface components|komponen (?:antarmuka|UI) yang dapat digunakan kembali/iu],
  ['software.mobile', 'software', 'mobile', /(?:develop|build) (?:native )?mobile applications|(?:mengembangkan|membangun) aplikasi (?:seluler|mobile|Android|iOS)/iu],
  ['software.verification', 'software', 'verification', /design test cases|verify software functionality|(?:menyusun|merancang) skenario pengujian|menguji fungsionalitas aplikasi/iu],
  ['software.pipelines', 'software', 'infrastructure', /(?:automate|build|manage) (?:\w+ ){0,3}(?:CI\/CD|deployment pipelines)|mengotomasi (?:\w+ ){0,2}(?:CI\/CD|deployment)/iu],
  ['software.reliability', 'software', 'infrastructure', /monitor (?:application|service|infrastructure) reliability|(?:memantau|menjaga) keandalan (?:layanan|infrastruktur)/iu],
  ['software.data-pipelines', 'software', 'data', /(?:design|build|maintain) (?:\w+ ){0,3}(?:ETL|data pipelines)|(?:membangun|memelihara) pipeline data/iu],
  ['software.train-models', 'software', 'modelling', /(?:train|evaluate|fine.tune) (?:\w+ ){0,3}(?:machine.learning models|AI models)|(?:melatih|mengevaluasi) model (?:AI|machine learning|pembelajaran mesin)/iu],
  ['warehouse.stock', 'logistics', 'inventory', /maintain stock control systems|reconcile inventory|(?:merekonsiliasi|mencocokkan) (?:jumlah |catatan |transaksi )?(?:stok|persediaan)|mencocokkan (?:catatan pemakaian|transaksi sistem) dengan (?:hasil )?hitung fisik|memeriksa jumlah persediaan/iu],
  ['warehouse.dispatch', 'logistics', 'inventory', /dispatch stock|monitor warehouse dispatch|(?:menyiapkan|mengawasi) pengiriman barang dari gudang/iu],
  ['warehouse.receive', 'logistics', 'inventory', /check (?:incoming|received) goods|inspect deliveries|memeriksa (?:dokumen dan kondisi barang saat penerimaan|kuantitas, kondisi, tanggal, dan dokumen saat bahan diterima)|menjaga.{0,25}rotasi stok/iu],
  ['warehouse.cold-chain', 'logistics', 'cold-chain', /monitor (?:cold storage|refrigerated transport) temperatures|(?:memeriksa|mencatat) suhu (?:ruang|chiller|freezer|kendaraan)/iu],
  ['procurement.suppliers', 'logistics', 'sourcing', /assess supplier risks|evaluate suppliers|(?:menilai|membandingkan|meninjau) (?:kinerja |penawaran )?pemasok/iu],
  ['procurement.orders', 'logistics', 'sourcing', /manage purchasing cycle|(?:membuat|menindaklanjuti|mengelola) pesanan pembelian|menyusun permintaan penawaran kepada pemasok/iu],
  ['production.schedule', 'manufacturing', 'planning', /schedule production batches|plan manufacturing schedules|(?:menjadwalkan|memperbarui urutan) (?:produksi|batch|bets)/iu],
  ['production.capacity', 'manufacturing', 'planning', /plan materials requirements|mengumpulkan.{0,70}kapasitas lini|menyelaraskan.{0,50}kapasitas.{0,50}bahan/iu],
  ['quality.sample', 'quality', 'testing', /(?:take|collect|test) (?:product |food )?samples|(?:mengambil|menguji|menyiapkan kode) sampel/iu],
  ['quality.inspect-product', 'quality', 'testing', /inspect products against|check product quality|(?:memeriksa|menguji).{0,35}(?:parameter mutu|mutu bahan|spesifikasi produk)/iu],
  ['quality.audit', 'quality', 'assurance', /conduct (?:internal|supplier|food safety) audits?|(?:melakukan|mendukung persiapan) audit (?:internal|pemasok)|melakukan inspeksi berbasis daftar periksa/iu],
  ['quality.corrective-action', 'quality', 'assurance', /manage corrective actions|(?:mengelola|memantau).{0,45}tindakan koreksi|meninjau efektivitas perbaikan/iu],
  ['engineering.preventive', 'engineering', 'maintenance', /perform preventive maintenance|(?:melaksanakan|menjadwalkan) preventive maintenance|melakukan pemeriksaan berkala pada.{0,35}(?:peralatan|ventilasi|saluran air)/iu],
  ['engineering.diagnose', 'engineering', 'maintenance', /diagnose (?:equipment|machine|mechanical) faults|menelusuri kerusakan mekanis|mencatat laporan kerusakan.{0,40}tindakan perbaikan/iu],
  ['engineering.electrical', 'engineering', 'electrical', /(?:inspect|install|repair) (?:electrical panels|electrical systems)|memeriksa (?:panel, pompa|panel listrik)|(?:memasang|memperbaiki) panel listrik/iu],
  ['food.formulation', 'food', 'development', /formulate food products|develop food formulations|(?:menyusun|mengembangkan) prototipe.{0,35}formula/iu],
  ['food.shelf-life', 'food', 'development', /(?:assess|test) shelf life|(?:menguji|pengujian) masa simpan/iu],
  ['pharma.registration', 'health', 'regulatory', /(?:submit|prepare) pharmaceutical registrations?|(?:mengajukan|menyiapkan).{0,25}(?:registrasi obat|berkas registrasi)|memantau jadwal pengajuan.{0,25}regulator/iu],
  ['pharma.safety', 'health', 'drug-safety', /assess adverse drug reactions|memeriksa kelengkapan laporan kejadian tidak diinginkan|memantau tenggat pelaporan.{0,25}(?:obat|perlindungan data pasien)/iu],
  ['service.handle-cases', 'service', 'support', /resolve customer complaints|(?:menangani|menindaklanjuti) keluhan (?:pelanggan|konsumen)|(?:mencatat|menelusuri).{0,25}kronologi keluhan/iu],
  ['service.escalation', 'service', 'support', /escalate customer (?:cases|complaints)|menghubungkan kasus (?:keamanan|mutu)|meneruskan keluhan platform/iu],
  ['service.order-accuracy', 'service', 'order-support', /(?:verify|confirm) order details|memeriksa pesanan masuk|merekonsiliasi pesanan dan pembayaran/iu],
  ['hr.orientation', 'people', 'training', /coordinate employee onboarding|conduct staff orientation|mencatat penyelesaian orientasi|menyusun materi orientasi/iu],
  ['hr.coaching', 'people', 'training', /deliver employee training|mengamati praktik kerja lalu memberi umpan balik|menyiapkan materi.{0,24}(?:SOP|pelatihan)/iu],
  ['finance.reconcile', 'finance', 'accounting', /reconcile accounts|maintain financial records|(?:merekonsiliasi|mencocokkan) (?:saldo|rekening|catatan keuangan)/iu],
  ['finance.credit-risk', 'finance', 'credit', /assess credit risk|analyse credit applications|(?:menilai|menganalisis).{0,25}(?:risiko kredit|pengajuan pembiayaan)/iu],
  ['education.instruction', 'education', 'teaching', /apply teaching strategies|teach primary education class content|(?:merancang|menyampaikan) kegiatan pembelajaran/iu],
  ['education.assessment', 'education', 'teaching', /assess students|assess child development|menilai (?:kemajuan|perkembangan) (?:siswa|anak)/iu],
  ['tour.guiding', 'tourism', 'guide', /guide visitors|lead visitors|(?:memandu|mendampingi) wisatawan|memberi briefing rute|menghitung peserta pada titik perpindahan/iu],
  ['tour.interpretation', 'tourism', 'guide', /interpret cultural|(?:menjelaskan|menginterpretasikan) (?:sejarah|budaya) destinasi|menyampaikan cerita destinasi/iu],
  ['tour.booking', 'tourism', 'booking', /manage bookings|issue tickets|(?:mengelola|mengonfirmasi|memasukkan) reservasi|menerbitkan tiket/iu],
  ['tour.confirmation', 'tourism', 'booking', /confirm tour reservations|mengonfirmasi kapasitas dengan (?:pemandu|operator)|mengirim ringkasan pemesanan/iu],
  ['tour.itinerary', 'tourism', 'planning', /plan travel itineraries|menyusun urutan kunjungan|merancang rencana perjalanan/iu],
  ['clinical.care', 'health', 'clinical', /monitor care plans|provide nursing care|(?:memberikan|mengoordinasikan) asuhan keperawatan/iu],
  ['clinical.pharmacy', 'health', 'pharmacy', /provide pharmaceutical advice|review prescriptions|menelaah resep|menyiapkan (?:bets|sediaan obat)/iu],
] as const;

export type TaskEvidence = { key: string; excerpt: string };
const lookup = new Map(concepts.map(([key, dimension, output]) => [key as string, {dimension,output}]));
const normalized = (s:string) => s.normalize('NFKC').replace(/&nbsp;|&#160;/gi,' ').trim();
const words = (s:string) => normalized(s).toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];

export function escoTaskDictionary(skills:ReadonlyArray<{uri:string;label:string;type:string;reuse:string}>) {
  const byStart=new Map<string,Array<{key:string;tokens:string[]}>>();
  const keys=new Set<string>();
  for(const skill of skills){
    if(skill.type!=='skill'||skill.reuse!=='occupation-specific')continue;
    const tokens=words(skill.label);
    if(tokens.length<3)continue;
    const entries=byStart.get(tokens[0]!)??[];
    entries.push({key:skill.uri,tokens});
    byStart.set(tokens[0]!,entries);
    keys.add(skill.uri);
  }
  return {keys, match(text:string) {
    const tokens=words(text);
    const matches=new Set<string>();
    for(let i=0;i<tokens.length;i++)
      for(const entry of byStart.get(tokens[i]!)??[])
        if(entry.tokens.every((token,j)=>tokens[i+j]===token))matches.add(entry.key);
    return matches;
  }};
}
export type EscoTaskDictionary=ReturnType<typeof escoTaskDictionary>;

export function taskEvidence(description: string,dictionary?:EscoTaskDictionary): TaskEvidence[] {
  const lines = description.slice(0, 40_000).replace(/<\/(?:p|li|h[1-6]|div)>|<br\s*\/?\s*>/gi,'\n')
    .replace(/<[^>]*>/g,' ').split(/[\n•]+/).map(normalized).filter(Boolean);
  const found = new Map<string,TaskEvidence>();
  let inDuties = false;
  const standaloneDuties=lines.length===1&&/^(?:build|develop|design|implement|operate|inspect|maintain|repair|teach|prepare|manage|mengembangkan|membangun|merancang|mengoperasikan|memeriksa|menangani|menyiapkan)\b/iu.test(lines[0]??'');
  for (const line of lines) {
    const heading=line.replace(/^[#*_\-\s]+|[*_]+$/g,'').trim();
    const shortDutyHeading=heading.length<=55&&/^(?:[\p{L}]+\s+){0,4}tanggung jawab(?: utama)?\s*:?$/iu.test(heading);
    if (shortDutyHeading||/^(?:tanggung jawab|tugas(?: utama)?|uraian tugas|job responsibilities|responsibilities|duties|what you.ll do|обязанности|vazifalar)(?:\s|:|$)/iu.test(heading)) inDuties = true;
    else if (/^(?:persyaratan|kualifikasi|required qualifications|requirements?|qualifications?|benefits?|keuntungan|tentang perusahaan|about (?:us|the company)|nilai tambah|компенсация|требования|talablar|kompensasi|cara melamar|pertanyaan penyaringan)(?:\s|:|$)/iu.test(heading)) inDuties = false;
    if (!inDuties&&!standaloneDuties) continue;
    for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
      if (/\b(?:tidak bertugas|tidak perlu|tidak akan|bukan bertanggung jawab|does not|will not|not responsible|nice to have)\b/i.test(sentence)) continue;
      for (const [key,,,pattern] of concepts)
        if (!found.has(key) && pattern.test(sentence)) found.set(key,{key,excerpt:sentence.slice(0,240)});
      for(const key of dictionary?.match(sentence)??[])
        if(!found.has(key))found.set(key,{key,excerpt:sentence.slice(0,240)});
    }
  }
  return [...found.values()];
}

export function professionTaskKeys(labels: readonly string[]): string[] {
  return concepts.filter(([, , ,pattern])=>labels.some(label=>pattern.test(label))).map(([key])=>key);
}

export function primaryTaskScope(keys: readonly string[]) {
  const scope=new Set<string>();
  for(const key of keys){
    const value=lookup.get(key);
    if(value&&value.output!=='support')scope.add(value.dimension+':'+value.output);
  }
  return scope;
}

export function taskCompatibility(source: readonly string[], vacancy: readonly string[], primary:ReadonlySet<string>=new Set()) {
  const vacancySet = new Set(vacancy);
  const shared = [...new Set(source)].filter(key=>vacancySet.has(key));
  const expected = source.map(key=>lookup.get(key)).filter(x=>x!==undefined);
  const observed = vacancy.map(key=>lookup.get(key)).filter(x=>x!==undefined);
  const byDimension = new Set(expected.map(x=>x.dimension));
  const explicitConflict=primary.size>0 && observed.length>=2 && !observed.some(value=>primary.has(value.dimension+':'+value.output));
  const conflict = explicitConflict || [...byDimension].some(dimension=>{
    const actual = observed.filter(x=>x.dimension===dimension);
    return actual.length>=2 && !actual.some(x=>expected.some(y=>y.dimension===dimension&&y.output===x.output));
  });
  const outputs=new Map<string,number>();
  for(const key of shared){
    const task=lookup.get(key);
    if(!task)continue;
    const id=task.dimension+':'+task.output;
    outputs.set(id,(outputs.get(id)??0)+1);
  }
  const anchored=[...outputs.values()].some(n=>n>=2);
  const official=shared.filter(key=>key.startsWith('http://data.europa.eu/esco/skill/')).length>=2;
  return {shared,conflict,strong:(anchored||official)&&!conflict};
}

export type VacancyEligibility = EmployeeEligibility & { sharedTasks?: string[] };
export const taskDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
