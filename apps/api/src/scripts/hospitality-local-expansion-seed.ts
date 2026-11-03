/**
 * Local-only content seed: 60 Indonesian hospitality vacancies for each of the
 * three selected showcase companies (180 new job posts total).
 *
 * Commands (from the API workspace):
 *   tsx src/scripts/hospitality-local-expansion-seed.ts --plan-local
 *   tsx src/scripts/hospitality-local-expansion-seed.ts --apply-local
 *   tsx src/scripts/hospitality-local-expansion-seed.ts --verify-local
 *   HOSPITALITY_SEED_TARGET=indonesia-vps tsx src/scripts/hospitality-local-expansion-seed.ts --plan-indonesia-vps
 *   HOSPITALITY_SEED_TARGET=indonesia-vps tsx src/scripts/hospitality-local-expansion-seed.ts --apply-indonesia-vps
 *   HOSPITALITY_SEED_TARGET=indonesia-vps tsx src/scripts/hospitality-local-expansion-seed.ts --verify-indonesia-vps
 *
 * Local writes are allowed only for 127.0.0.1:5434/job_talentio.
 * VPS writes are allowed only from the Talentio API container on the VPS,
 * with the explicit target marker and DATABASE_URL host.docker.internal:5432/talentio.
 * The VPS mode targets the existing Indonesia company records and never creates replacements.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ExperienceLevel, Prisma, PrismaClient } from '@prisma/client';
import { contentHash, jobFingerprint } from '../common/dedupe';
import { EmployeeOccupationIndex, intentRoleInclude } from '../matching/employee-occupation';
import { FEATURED_COMPANIES, type FeaturedCompany } from './featured-company-carousel-manifest';

const TARGET_SLUGS = [
  'jelajah-rasa-indonesia',
  'wisata-pesisir-indonesia',
  'pangan-kita-nusantara',
] as const;
const SEED_VERSION = 'local-hospitality-180-v1';
const COMPANY_ID_PREFIX = 'featured-carousel-v1-company-';
const YEAR_EXPERIENCE = [1, 3, 6] as const;
const LEVELS: readonly {
  code: ExperienceLevel;
  scope: string;
  extraDuty: string;
  extraRequirement: string;
}[] = [
  {
    code: 'JUNIOR',
    scope: 'menjalankan tugas harian sesuai SOP, menjaga catatan kerja tetap lengkap, dan segera meminta arahan ketika menemukan kondisi yang menyimpang',
    extraDuty: 'mencatat hasil kerja pada formulir atau sistem yang digunakan tim dan mengeskalasi kendala sebelum berdampak pada tamu, produk, atau jadwal',
    extraRequirement: 'terbuka menerima pengarahan, disiplin mengikuti SOP, dan mampu menyampaikan masalah dengan jelas',
  },
  {
    code: 'MIDDLE',
    scope: 'mengelola satu area atau giliran kerja secara mandiri, menyelaraskan kebutuhan lintas tim, dan menindaklanjuti kendala sampai tuntas',
    extraDuty: 'membantu membagi prioritas kerja saat beban meningkat serta memberi umpan balik praktis kepada rekan satu giliran',
    extraRequirement: 'mampu mengambil keputusan operasional dalam batas kewenangan dan menyusun serah-terima kerja yang akurat',
  },
  {
    code: 'SENIOR',
    scope: 'menetapkan standar pelaksanaan untuk area tanggung jawabnya, membina anggota tim, dan menggunakan data operasional untuk mencegah masalah berulang',
    extraDuty: 'meninjau pola hasil kerja, menetapkan tindakan koreksi bersama atasan, dan memastikan anggota tim memahami perubahan prosedur',
    extraRequirement: 'memiliki pengalaman membimbing rekan kerja serta mampu mempertanggungjawabkan hasil dan keputusan operasional',
  },
];

type Family = {
  slug: string;
  titles: [string, string, string];
  mission: string;
  duties: [string, string, string];
  requirements: [string, string, string];
  preferred: [string, string];
  skillSlugs: string[];
  questions: [string, string];
  baseSalary: number;
  schedule: string;
};

function family(
  slug: string,
  titles: [string, string, string],
  mission: string,
  duties: [string, string, string],
  requirements: [string, string, string],
  preferred: [string, string],
  skillSlugs: string[],
  questions: [string, string],
  baseSalary: number,
  schedule: string,
): Family {
  return { slug, titles, mission, duties, requirements, preferred, skillSlugs, questions, baseSalary, schedule };
}

const FAMILIES: Record<(typeof TARGET_SLUGS)[number], Family[]> = {
  'jelajah-rasa-indonesia': [
    family('hot-kitchen', ['Koki Persiapan Dapur Panas', 'Koki Dapur Panas', 'Sous Chef Dapur Panas'], 'menghasilkan hidangan panas dengan rasa, porsi, suhu, dan waktu penyajian yang konsisten pada jam layanan ramai.', ['menyiapkan mise en place berdasarkan reservasi, perkiraan penjualan, dan resep baku', 'memasak menu tumis, panggang, dan goreng sesuai urutan tiket serta standar penyajian', 'memeriksa kebersihan area, suhu penyimpanan, dan pemisahan bahan mentah dari makanan matang'], ['memiliki pengalaman kerja dapur profesional dan memahami alur persiapan hingga penyajian', 'mampu membaca resep, mengukur bahan, dan menjaga kebersihan peralatan selama giliran kerja', 'siap bekerja bergiliran termasuk akhir pekan dan hari libur sesuai jadwal outlet'], ['pernah menangani dapur dengan volume pesanan tinggi', 'memiliki pelatihan higiene atau keamanan pangan'], ['food-safety', 'hospitality-management', 'teamwork', 'communication'], ['Bagaimana Anda mengatur urutan persiapan ketika reservasi dan pesanan mendadak datang bersamaan?', 'Apa pemeriksaan yang Anda lakukan sebelum makanan keluar dari dapur?'], 6_500_000, 'Jadwal bergiliran mengikuti jam makan siang dan malam; akhir pekan dapat menjadi hari kerja.'),
    family('cold-kitchen', ['Koki Salad dan Hidangan Dingin', 'Koki Senior Dapur Dingin', 'Kepala Dapur Dingin'], 'menjaga kesegaran, tampilan, dan keamanan salad, sambal, makanan pembuka, serta hidangan dingin lainnya.', ['menyiapkan sayuran, saus, garnish, dan bahan dingin dengan metode potong serta porsi yang ditetapkan', 'memantau suhu chiller, rotasi bahan, dan batas waktu penggunaan setelah persiapan', 'mengatur urutan plating agar tampilan antar porsi tetap seragam'], ['memahami penanganan bahan segar dan pencegahan kontaminasi silang', 'mampu bekerja teliti dengan pisau serta menjaga area persiapan tetap bersih', 'bersedia mengikuti prosedur pencatatan suhu dan rotasi stok harian'], ['pernah menyiapkan hidangan dingin atau salad dalam jumlah besar', 'mengenal FIFO dan penandaan waktu persiapan'], ['food-safety', 'hospitality-management', 'teamwork', 'problem-solving'], ['Bagaimana Anda menjaga kesegaran bahan yang sudah dicuci ketika volume pesanan berubah?', 'Apa yang Anda lakukan jika bahan yang telah dipersiapkan tidak lagi memenuhi standar tampilan?'], 6_500_000, 'Jadwal mengikuti giliran persiapan dan layanan; pekerjaan berlangsung di dapur berpendingin.'),
    family('bakery-pastry', ['Asisten Baker Restoran', 'Baker dan Pengembang Pastry', 'Chef Pastry Restoran'], 'menyediakan roti dan dessert dengan ukuran, kematangan, tekstur, serta rasa yang sesuai resep outlet.', ['menimbang bahan dan menyiapkan adonan atau komponen dessert sesuai lembar produksi', 'mengoperasikan oven dan peralatan pastry berdasarkan parameter resep', 'mencatat hasil produksi, sisa bahan, dan kebutuhan persiapan untuk giliran berikutnya'], ['memahami dasar pemanggangan atau pembuatan pastry dan mampu mengikuti resep tertulis', 'teliti menimbang bahan serta menjaga konsistensi waktu dan suhu', 'memahami sanitasi alat dan pemisahan bahan yang mengandung alergen'], ['pernah membuat produk bakery atau dessert untuk layanan komersial', 'mampu mengembangkan variasi menu dengan bahan lokal'], ['food-safety', 'hospitality-management', 'problem-solving', 'teamwork'], ['Bagaimana Anda mencari penyebab tekstur produk berubah dari satu batch ke batch berikutnya?', 'Bagaimana Anda memastikan bahan alergen tidak tertukar saat produksi?'], 6_800_000, 'Persiapan dapat dimulai sebelum jam buka; jadwal ditetapkan bersama kepala dapur.'),
    family('indonesian-menu', ['Commis Menu Nusantara', 'Koki Spesialis Menu Nusantara', 'Chef Pengembangan Menu Lokal'], 'menyajikan resep daerah dengan cita rasa yang terjaga sambil menyesuaikan produksi dengan ketersediaan bahan musiman.', ['mengolah bumbu dasar dan komponen menu mengikuti resep serta catatan takaran', 'memeriksa rasa, tingkat kematangan, porsi, dan keterangan bahan sebelum hidangan disajikan', 'memberi masukan kepada tim pembelian saat mutu atau ketersediaan bahan lokal berubah'], ['memiliki pengalaman memasak masakan Indonesia di dapur profesional', 'mampu menjaga konsistensi resep sambil mengikuti arahan pengembangan menu', 'memahami kebersihan bahan dan cara menyimpan bumbu serta produk setengah jadi'], ['mengenal masakan Sunda dan teknik pengolahan bahan lokal', 'pernah membantu uji resep atau pencatatan standard recipe'], ['food-safety', 'hospitality-management', 'supply-chain', 'teamwork'], ['Bagaimana Anda menjaga rasa resep ketika bahan musiman memiliki karakter berbeda?', 'Informasi apa yang perlu dicatat ketika resep baru diuji untuk pertama kali?'], 6_700_000, 'Jadwal mengikuti persiapan dapur dan periode layanan outlet.'),
    family('table-service', ['Pramusaji Restoran', 'Pramusaji Senior', 'Koordinator Layanan Meja'], 'membuat tamu merasa disambut dan menerima pesanan yang tepat dari saat duduk hingga pembayaran selesai.', ['menjelaskan menu, bahan utama, tingkat kepedasan, serta pilihan yang tersedia tanpa membuat klaim yang belum dipastikan', 'mencatat pesanan dan permintaan khusus secara akurat lalu meneruskannya ke dapur', 'memantau meja, mengantar hidangan, dan meminta bantuan saat keluhan perlu ditangani atasan'], ['memiliki pengalaman layanan pelanggan atau kesiapan belajar standar layanan restoran', 'mampu berkomunikasi dengan sopan dan mengingat rincian pesanan', 'siap banyak berdiri dan bekerja dengan jadwal bergiliran'], ['pernah menggunakan sistem POS atau perangkat pemesanan meja', 'mampu berkomunikasi dasar dalam bahasa Inggris'], ['hospitality-management', 'customer-support', 'communication', 'teamwork'], ['Bagaimana Anda menangani pesanan dengan alergi makanan agar informasinya tidak terlewat?', 'Apa yang Anda lakukan ketika hidangan yang diterima tamu berbeda dari pesanannya?'], 6_200_000, 'Jadwal bergiliran meliputi periode makan siang, makan malam, akhir pekan, dan hari libur.'),
    family('host-reservations', ['Host Restoran', 'Kapten Reservasi dan Host', 'Supervisor Pengalaman Tamu'], 'mengatur kedatangan, antrean, reservasi, dan kebutuhan awal tamu agar alur ruang makan tetap nyaman.', ['menyambut tamu, memeriksa reservasi, dan mencatat jumlah serta kebutuhan rombongan', 'mengatur daftar tunggu dan komunikasi perkiraan waktu tanpa menjanjikan meja yang belum tersedia', 'menyampaikan kebutuhan aksesibilitas, perayaan, atau permintaan khusus kepada tim layanan'], ['memiliki pengalaman resepsionis, reservasi, atau layanan tamu', 'mampu menggunakan daftar reservasi dan berkomunikasi jelas saat area ramai', 'menjaga kerahasiaan informasi kontak serta preferensi pelanggan'], ['pernah menangani reservasi kelompok atau acara kecil', 'mampu berkomunikasi dalam bahasa Inggris untuk kebutuhan dasar'], ['hospitality-management', 'customer-support', 'communication', 'excel'], ['Bagaimana Anda mengatur daftar tunggu ketika beberapa rombongan datang bersamaan?', 'Informasi apa yang perlu dikonfirmasi sebelum menerima reservasi acara?'], 6_300_000, 'Jadwal mengikuti jam kedatangan tamu dan kebutuhan reservasi, termasuk akhir pekan.'),
    family('cashier-pos', ['Kasir Restoran', 'Kasir Senior dan Pengendali Transaksi', 'Koordinator Kasir Outlet'], 'memastikan transaksi pembayaran, pembatalan, dan laporan kas harian tercatat dengan tepat.', ['memproses pembayaran tunai dan nontunai sesuai prosedur outlet', 'memeriksa kesesuaian tagihan dengan pesanan sebelum transaksi diselesaikan', 'menyiapkan rekonsiliasi kas dan melaporkan selisih berdasarkan bukti transaksi'], ['teliti berhitung dan mampu mengoperasikan POS atau perangkat kasir setelah pelatihan', 'jujur menangani uang, bukti pembayaran, dan data transaksi pelanggan', 'bersedia bekerja bergiliran serta mengikuti prosedur tutup kas'], ['pernah menangani pembayaran restoran atau ritel', 'mahir menggunakan spreadsheet dasar untuk pencatatan'], ['hospitality-management', 'excel', 'problem-solving', 'communication'], ['Apa langkah Anda jika jumlah kas akhir giliran tidak sesuai dengan laporan POS?', 'Bagaimana Anda membantu tamu saat transaksi nontunai gagal tetapi saldo terpotong?'], 6_200_000, 'Jadwal bergiliran mengikuti jam operasional; proses tutup kas dilakukan pada akhir giliran.'),
    family('barista', ['Barista Outlet', 'Barista Senior', 'Kepala Bar Kopi'], 'menyiapkan kopi dan minuman berbasis espresso dengan mutu ekstraksi serta waktu penyajian yang stabil.', ['mengatur grinder, menyiapkan espresso, dan mengikuti resep minuman standar', 'membersihkan mesin dan area bar berdasarkan jadwal perawatan harian', 'mengomunikasikan stok biji kopi, susu, dan bahan minuman kepada tim persediaan'], ['memiliki minat atau pengalaman menyiapkan kopi dan bersedia menjalani uji keterampilan', 'memahami kebersihan alat, penyimpanan susu, dan konsistensi takaran', 'mampu berinteraksi ramah dengan tamu saat antrean meningkat'], ['pernah memakai mesin espresso komersial', 'memahami dasar pencatatan rasa atau dial-in espresso'], ['hospitality-management', 'customer-support', 'food-safety', 'teamwork'], ['Bagaimana Anda menyesuaikan ekstraksi ketika hasil espresso terasa berbeda dari standar?', 'Apa rutinitas pembersihan yang penting untuk menjaga mutu mesin dan minuman?'], 6_500_000, 'Jadwal mengikuti jam buka outlet dan dapat mencakup akhir pekan.'),
    family('beverage-station', ['Peracik Minuman Nonalkohol', 'Spesialis Minuman Signature', 'Koordinator Program Minuman'], 'menyiapkan minuman dingin dan hangat nonalkohol dengan takaran, presentasi, serta catatan alergen yang jelas.', ['meracik minuman sesuai resep dan memeriksa ketersediaan garnish serta es', 'menjaga kebersihan wadah, blender, dan area kerja selama layanan', 'mencatat pemakaian bahan dan mengusulkan penyesuaian resep berdasarkan masukan tamu'], ['mampu mengikuti resep dan bekerja cepat tanpa mengabaikan ketelitian', 'memahami sanitasi alat dan penanganan bahan seperti susu, buah, serta sirup', 'mampu menjelaskan komposisi minuman secara akurat kepada tamu'], ['pernah meracik minuman di kafe atau restoran', 'tertarik mengembangkan minuman dari bahan lokal'], ['food-safety', 'hospitality-management', 'customer-support', 'problem-solving'], ['Bagaimana Anda menghindari salah takar ketika banyak minuman berbeda dipesan sekaligus?', 'Bagaimana Anda menjawab pertanyaan tentang kandungan gula atau alergen minuman?'], 6_300_000, 'Jadwal mengikuti jam layanan restoran; pengaturan giliran dibahas dengan koordinator bar.'),
    family('kitchen-expediter', ['Runner Dapur dan Pengantar Hidangan', 'Ekspeditor Pesanan Restoran', 'Koordinator Ekspeditor Layanan'], 'menjaga pesanan bergerak dengan benar antara dapur dan meja tanpa mengorbankan suhu, kelengkapan, atau urutan penyajian.', ['mencocokkan hidangan dengan tiket sebelum pesanan meninggalkan pass dapur', 'menata urutan pengantaran sesuai meja, waktu keluar, dan kebutuhan hidangan khusus', 'menginformasikan kekurangan item atau keterlambatan kepada pramusaji dan dapur'], ['mampu bekerja cepat, teliti, dan berkomunikasi singkat saat outlet ramai', 'memahami penanda meja, nomor pesanan, dan cara membawa hidangan dengan aman', 'siap bekerja sambil berdiri serta berpindah antara dapur dan ruang makan'], ['pernah bekerja sebagai runner, pramusaji, atau kru dapur', 'mampu membantu pengecekan ulang pesanan dengan POS'], ['hospitality-management', 'teamwork', 'communication', 'problem-solving'], ['Bagaimana Anda memastikan hidangan untuk meja yang sama tidak tertukar?', 'Apa yang Anda sampaikan ketika satu komponen pesanan belum siap?'], 6_100_000, 'Jadwal mengikuti puncak layanan makan siang dan malam.'),
    family('stewarding', ['Steward Restoran', 'Kapten Stewarding', 'Supervisor Stewarding'], 'memastikan peralatan makan dan perlengkapan dapur kembali bersih, aman, serta siap dipakai sesuai ritme layanan.', ['mencuci dan memilah peralatan berdasarkan jenis serta prosedur kebersihan', 'menjaga area pencucian tetap rapi dan mengatur sirkulasi peralatan bersih-kotor', 'melaporkan kerusakan, kekurangan peralatan, atau bahan pembersih kepada penanggung jawab'], ['memiliki stamina untuk pekerjaan berulang dan mampu mengikuti instruksi keselamatan bahan pembersih', 'memahami pemisahan peralatan bersih dari peralatan yang belum dicuci', 'bersedia bekerja bergiliran pada akhir pekan dan hari libur'], ['pernah bekerja di stewarding hotel atau restoran', 'memiliki pengalaman memimpin pembagian kerja tim kecil'], ['food-safety', 'hospitality-management', 'teamwork', 'problem-solving'], ['Bagaimana Anda mengatur alur peralatan saat area cuci menerima lonjakan piring kotor?', 'Apa tindakan yang Anda ambil bila menemukan gelas retak di rak peralatan bersih?'], 6_000_000, 'Jadwal bergiliran dapat dimulai sebelum pembukaan atau berakhir setelah layanan tutup.'),
    family('outlet-sanitation', ['Petugas Kebersihan Area Restoran', 'Petugas Sanitasi Outlet', 'Koordinator Sanitasi Restoran'], 'menjaga ruang makan, toilet, dan area kerja umum bersih serta nyaman selama outlet beroperasi.', ['melaksanakan jadwal pembersihan area dengan bahan dan alat sesuai petunjuk', 'mengisi catatan pemeriksaan kebersihan dan menindaklanjuti temuan yang berulang', 'memasang tanda peringatan saat lantai basah atau area sedang dibersihkan'], ['mampu bekerja rapi dan memahami cara aman menggunakan bahan pembersih', 'siap bekerja dengan jadwal bergiliran dan menangani area yang ramai pengunjung', 'mampu melaporkan kerusakan fasilitas yang memengaruhi kebersihan atau keselamatan'], ['pernah bekerja dalam kebersihan fasilitas komersial', 'memahami penggunaan daftar periksa sanitasi'], ['food-safety', 'hospitality-management', 'teamwork'], ['Bagaimana Anda mengatur pembersihan tanpa mengganggu tamu yang sedang makan?', 'Apa tindakan Anda saat menemukan tumpahan yang berisiko membuat tamu terpeleset?'], 6_000_000, 'Jadwal mencakup persiapan sebelum outlet buka dan pembersihan setelah periode layanan.'),
    family('catering-operations', ['Koordinator Katering Acara Kecil', 'Spesialis Operasi Katering', 'Manajer Operasi Katering'], 'mengirimkan layanan katering yang sesuai pesanan dan tetap terkoordinasi antara pelanggan, dapur, serta tim pengantaran.', ['mengonfirmasi menu, jumlah porsi, waktu penyajian, alamat, dan akses lokasi', 'menyiapkan lembar kerja acara yang mencantumkan kebutuhan makanan khusus', 'memantau kesiapan produksi, pengemasan, keberangkatan, serta evaluasi setelah acara'], ['memiliki pengalaman layanan acara, katering, atau operasional restoran', 'mampu menyusun jadwal dan memeriksa rincian pesanan secara sistematis', 'siap melakukan koordinasi di lokasi acara sesuai kebutuhan'], ['pernah menangani acara komunitas atau perusahaan', 'mengenal prosedur pengemasan dan pengangkutan makanan'], ['project-management', 'hospitality-management', 'customer-support', 'communication'], ['Apa rincian yang Anda konfirmasi sebelum menyerahkan pesanan ke dapur?', 'Bagaimana Anda menangani perubahan jumlah porsi menjelang waktu pengiriman?'], 6_600_000, 'Jadwal dapat berubah mengikuti tanggal acara dan mungkin mencakup akhir pekan.'),
    family('group-reservations-sales', ['Admin Reservasi Kelompok', 'Konsultan Acara dan Reservasi', 'Koordinator Penjualan Acara'], 'mengubah kebutuhan makan kelompok menjadi reservasi atau paket acara yang ruang lingkupnya jelas bagi pelanggan dan outlet.', ['mengumpulkan jumlah tamu, anggaran, tanggal, preferensi menu, serta kebutuhan ruang', 'menyusun penawaran dan memastikan batas waktu konfirmasi dipahami pelanggan', 'meneruskan kesepakatan yang disetujui kepada dapur, kasir, dan tim layanan'], ['memiliki pengalaman administrasi reservasi, penjualan layanan, atau hubungan pelanggan', 'mampu menyusun penawaran dengan rincian harga dan ketentuan yang jelas', 'teliti menyimpan komunikasi dan perubahan permintaan pelanggan'], ['pernah menjual layanan restoran atau paket acara', 'mampu menggunakan spreadsheet dan email bisnis'], ['sales', 'hospitality-management', 'customer-support', 'excel'], ['Bagaimana Anda menyampaikan pilihan paket ketika anggaran pelanggan belum mencakup seluruh kebutuhannya?', 'Informasi apa yang harus tercatat agar tim outlet dapat menyiapkan acara dengan tepat?'], 6_500_000, 'Jam kerja utama mengikuti kebutuhan reservasi dan koordinasi acara; sesekali hadir di acara.'),
    family('kitchen-inventory', ['Petugas Penerimaan Bahan Dapur', 'Pengendali Stok Dapur', 'Supervisor Inventori Dapur'], 'menjaga bahan dan perlengkapan dapur tersedia dalam jumlah yang tepat serta terdokumentasi dari penerimaan hingga pemakaian.', ['memeriksa kuantitas, kondisi, tanggal, dan dokumen saat bahan diterima', 'menata penyimpanan berdasarkan jenis produk, rotasi, dan pemisahan bahan', 'mencocokkan catatan pemakaian dengan hasil hitung fisik dan melaporkan selisih'], ['teliti pada angka, label, dan kondisi bahan pangan', 'memahami FIFO atau FEFO dan dasar pencatatan persediaan', 'mampu bekerja sama dengan pembelian serta tim dapur saat stok perlu dikoreksi'], ['pernah menangani stok restoran, gudang, atau penerimaan barang', 'mahir menggunakan spreadsheet atau aplikasi inventori'], ['supply-chain', 'excel', 'food-safety', 'problem-solving'], ['Apa yang Anda lakukan saat barang datang dengan jumlah cukup tetapi mutu atau suhunya tidak sesuai?', 'Bagaimana Anda menentukan bahan yang perlu diprioritaskan untuk segera digunakan?'], 6_400_000, 'Jadwal mencakup penerimaan bahan pagi dan pemeriksaan stok sebelum giliran layanan.'),
    family('restaurant-procurement', ['Asisten Pembelian Restoran', 'Pembeli Bahan Segar dan Lokal', 'Koordinator Pengadaan Outlet'], 'mendapatkan bahan dan perlengkapan restoran yang memenuhi spesifikasi dengan harga serta jadwal pasok yang disepakati.', ['mengumpulkan kebutuhan pembelian dari dapur dan membandingkan penawaran pemasok', 'memastikan spesifikasi, jumlah, harga, jadwal, dan ketentuan penggantian tercatat', 'meninjau kinerja pemasok bersama tim penerimaan dan menindaklanjuti barang yang tidak sesuai'], ['memiliki pengalaman administrasi pembelian atau pengadaan bahan pangan', 'mampu bernegosiasi secara profesional dan menjaga dokumen transaksi', 'siap berkomunikasi dengan pemasok lokal serta merespons perubahan ketersediaan bahan'], ['memiliki jejaring pemasok hasil bumi atau produk lokal', 'pernah membantu evaluasi biaya dan mutu pemasok'], ['supply-chain', 'sales', 'communication', 'excel'], ['Bagaimana Anda menjaga mutu saat pemasok mengusulkan pengganti bahan yang sedang kosong?', 'Informasi apa yang Anda pakai untuk membandingkan dua penawaran pemasok?'], 6_700_000, 'Jam kerja mengikuti siklus pemesanan dan penerimaan bahan; sesekali melakukan kunjungan pemasok.'),
    family('digital-orders', ['Pelayan Pesanan Digital', 'Koordinator Pesanan Online', 'Supervisor Kanal Pemesanan'], 'memastikan pesanan dari kanal digital masuk ke dapur, dibayar, dan diserahkan dengan rincian yang benar.', ['memeriksa pesanan masuk, waktu penyiapan, alamat, dan catatan pelanggan', 'mengoordinasikan ketersediaan menu dengan dapur sebelum menerima perubahan atau substitusi', 'menangani pertanyaan dan meneruskan keluhan platform kepada penanggung jawab outlet'], ['mampu menggunakan perangkat digital dan mencatat pesanan dengan teliti', 'berkomunikasi jelas dengan dapur, kurir, dan pelanggan', 'mampu bekerja pada periode ramai tanpa mengabaikan pemeriksaan ulang'], ['pernah menangani platform pemesanan makanan atau layanan pelanggan', 'mengenal dasar rekonsiliasi pesanan dan pembayaran'], ['customer-support', 'communication', 'problem-solving', 'excel'], ['Bagaimana Anda menangani pesanan digital yang itemnya tidak tersedia setelah pembayaran?', 'Apa yang perlu diperiksa sebelum pesanan diserahkan kepada kurir?'], 6_300_000, 'Jadwal mengikuti periode puncak pemesanan, termasuk malam dan akhir pekan.'),
    family('restaurant-maintenance', ['Teknisi Fasilitas Restoran', 'Teknisi Pemeliharaan Outlet', 'Koordinator Fasilitas Restoran'], 'menjaga peralatan dan fasilitas outlet berfungsi aman agar kegiatan dapur dan layanan tidak terganggu.', ['melakukan pemeriksaan berkala pada lampu, saluran air, ventilasi, dan peralatan ringan', 'mencatat laporan kerusakan, tingkat urgensi, komponen, dan tindakan perbaikan', 'mengatur pekerjaan vendor dan memastikan area diserahkan kembali dalam keadaan aman'], ['memiliki pengalaman pemeliharaan fasilitas atau peralatan komersial', 'memahami penguncian area kerja serta prosedur keselamatan dasar', 'mampu menjelaskan dampak kerusakan dan kebutuhan penghentian alat kepada kepala outlet'], ['memiliki keterampilan listrik, pendingin, atau mekanik sesuai bidangnya', 'pernah membuat jadwal preventive maintenance'], ['problem-solving', 'hospitality-management', 'electrical-engineering', 'communication'], ['Bagaimana Anda menentukan prioritas ketika beberapa peralatan outlet dilaporkan rusak?', 'Apa yang Anda periksa sebelum menyatakan area aman dipakai kembali?'], 7_000_000, 'Jadwal pemeliharaan disesuaikan dengan jam sepi dan kadang dilakukan sebelum outlet buka.'),
    family('service-training', ['Asisten Orientasi Kru Layanan', 'Spesialis Standar Layanan', 'Koordinator Pelatihan Outlet'], 'membantu kru baru memahami menu, alur layanan, kebersihan, dan cara merespons kebutuhan tamu dengan konsisten.', ['menyiapkan materi singkat tentang menu, SOP, keselamatan kerja, dan penggunaan POS', 'mengamati praktik kerja lalu memberi umpan balik berdasarkan perilaku yang dapat dilihat', 'mencatat penyelesaian orientasi dan kebutuhan latihan lanjutan setiap anggota tim'], ['memiliki pengalaman layanan restoran atau pelatihan operasional', 'mampu menjelaskan prosedur dengan sabar dan memberi contoh praktik', 'menjaga catatan pelatihan serta bekerja sama dengan supervisor tiap giliran'], ['pernah menjadi buddy atau trainer untuk kru baru', 'memiliki pengalaman menyusun checklist kompetensi kerja'], ['hospitality-management', 'leadership', 'communication', 'teamwork'], ['Bagaimana Anda memastikan kru baru memahami alasan di balik SOP, bukan hanya menghafalnya?', 'Apa cara Anda memberi koreksi ketika standar layanan terlewat saat outlet ramai?'], 6_800_000, 'Jadwal mengikuti kebutuhan orientasi dan observasi langsung di outlet.'),
    family('restaurant-operations', ['Asisten Analis Kinerja Outlet', 'Analis Kinerja dan Mutu Outlet', 'Koordinator Peningkatan Kinerja Restoran'], 'mengubah data layanan, penjualan, limbah, dan umpan balik tamu menjadi perbaikan operasional yang dapat diukur.', ['menggabungkan waktu penyajian, penjualan POS, pembatalan, catatan sisa bahan, dan umpan balik tamu', 'membandingkan hasil antar giliran untuk menemukan pola yang dapat ditindaklanjuti tanpa menyalahkan anggota tim', 'mengoordinasikan uji perbaikan bersama dapur dan layanan lalu mencatat dampaknya pada tinjauan mingguan'], ['memiliki pengalaman analisis operasional, administrasi restoran, atau pelaporan layanan', 'mampu menggunakan spreadsheet dan menjaga definisi metrik tetap konsisten', 'mampu menerjemahkan temuan data menjadi langkah praktis yang dapat diuji di outlet'], ['pernah menggunakan laporan POS atau dashboard operasional', 'memiliki pengalaman perbaikan proses layanan atau pengendalian food waste'], ['hospitality-management', 'data-analysis', 'excel', 'problem-solving', 'communication'], ['Bagaimana Anda memastikan kenaikan waktu penyajian bukan hanya akibat perubahan jumlah pesanan?', 'Ceritakan cara Anda menguji apakah suatu perubahan operasional benar-benar memperbaiki hasil.'], 8_000_000, 'Jadwal utama mengikuti tinjauan operasional; observasi lapangan dilakukan pada beberapa giliran.'),
  ],
  'wisata-pesisir-indonesia': [
    family('guest-arrivals', ['Petugas Penerimaan Tamu Wisata', 'Spesialis Layanan Tamu', 'Supervisor Layanan Tamu'], 'memberikan informasi yang akurat dan sambutan yang tertata sejak tamu menghubungi kantor hingga tiba di titik layanan.', ['memeriksa identitas reservasi, jadwal, jumlah peserta, dan catatan kebutuhan tamu', 'menjelaskan titik kumpul, durasi kegiatan, perlengkapan, serta aturan keselamatan dengan bahasa yang mudah dipahami', 'meneruskan kebutuhan aksesibilitas atau kondisi khusus kepada operasi dengan persetujuan tamu'], ['memiliki pengalaman layanan pelanggan, hotel, atau perjalanan wisata', 'mampu menulis pesan dan berkomunikasi lisan secara jelas dalam bahasa Indonesia', 'menjaga kerahasiaan data kontak dan rincian perjalanan tamu'], ['mampu melayani percakapan dasar dalam bahasa Inggris', 'pernah menangani tamu internasional atau kebutuhan aksesibilitas'], ['hospitality-management', 'customer-support', 'communication', 'english'], ['Bagaimana Anda menjelaskan perubahan jadwal kepada tamu yang sudah berada di titik kumpul?', 'Bagaimana Anda mencatat kebutuhan khusus tanpa membagikan informasi pribadi secara berlebihan?'], 6_500_000, 'Jadwal bergiliran mengikuti jam keberangkatan tur dan dapat dimulai pagi hari.'),
    family('tour-reservations', ['Admin Reservasi Tur', 'Spesialis Reservasi dan Tiket', 'Koordinator Reservasi Wisata'], 'menjaga pemesanan tur, kapasitas mitra, pembayaran, dan dokumen konfirmasi tetap akurat sebelum tanggal kegiatan.', ['memasukkan reservasi dan memastikan tanggal, jumlah peserta, paket, serta titik jemput benar', 'mengonfirmasi kapasitas dengan pemandu, penginapan, dan operator kegiatan sebelum mengirim kepastian', 'mengirim ringkasan pemesanan dan mencatat perubahan atau pembatalan sesuai ketentuan tertulis'], ['teliti mengelola nama, tanggal, jumlah peserta, dan rincian pembayaran', 'mampu menggunakan sistem reservasi atau spreadsheet setelah orientasi', 'mampu menyampaikan ketentuan perubahan dengan jelas dan sopan'], ['pernah menangani reservasi hotel, tiket, atau perjalanan', 'mampu menggunakan bahasa Inggris tertulis untuk pesan rutin'], ['hospitality-management', 'excel', 'customer-support', 'communication'], ['Bagaimana Anda mencegah reservasi ganda saat kapasitas mitra berubah?', 'Apa yang Anda konfirmasi sebelum mengirim voucher atau informasi keberangkatan?'], 6_400_000, 'Jadwal mengikuti jam layanan reservasi dan kebutuhan konfirmasi mitra.'),
    family('itinerary-design', ['Konsultan Perjalanan Bali', 'Perencana Itinerary Wisata', 'Manajer Produk Perjalanan'], 'menyusun rencana perjalanan yang menarik, realistis, sesuai waktu tempuh, dan mempertimbangkan kondisi tamu serta lokasi.', ['menggali minat, batas waktu, anggaran, kondisi mobilitas, dan preferensi perjalanan tamu', 'menyusun urutan kunjungan dengan waktu tempuh dan jeda yang memadai', 'memeriksa ketersediaan mitra, jam operasional, aturan lokasi, dan alternatif jika cuaca berubah'], ['memiliki pengalaman perjalanan wisata, layanan tamu, atau perencanaan paket', 'mampu membuat itinerary tertulis dengan detail jadwal dan batasan layanan', 'tidak membuat klaim akses, durasi, atau ketersediaan yang belum diverifikasi'], ['mengenal destinasi Bali dan praktik wisata yang menghormati komunitas lokal', 'mampu menulis itinerary dalam bahasa Inggris'], ['hospitality-management', 'project-management', 'communication', 'english'], ['Bagaimana Anda menyusun rencana cadangan saat kegiatan luar ruang berisiko dibatalkan?', 'Bagaimana Anda menyesuaikan itinerary untuk tamu dengan waktu perjalanan yang terbatas?'], 7_000_000, 'Jam kerja mengikuti konsultasi dan tenggat penyusunan paket; ada kunjungan lapangan berkala.'),
    family('tour-guiding', ['Asisten Pemandu Wisata', 'Pemandu Budaya dan Pesisir', 'Kepala Pemandu Wisata'], 'membawakan pengalaman wisata dengan informasi yang akurat, menghormati budaya setempat, dan menjaga kelompok tetap bersama.', ['memberi briefing rute, durasi, perilaku yang diharapkan, dan aturan lokasi sebelum kegiatan', 'menyampaikan cerita destinasi yang telah diverifikasi tanpa mengganggu kegiatan warga', 'menghitung peserta pada titik perpindahan dan menginformasikan perubahan kepada koordinator'], ['memiliki pengalaman memandu, edukasi publik, atau layanan kelompok', 'mampu mengelola waktu, berbicara di depan kelompok, dan menjawab pertanyaan dengan jujur', 'siap bekerja di luar ruang dan mengikuti prosedur keselamatan perjalanan'], ['memiliki sertifikasi pemandu wisata yang relevan atau pengalaman rute lokal', 'mampu memandu tamu dalam bahasa Inggris'], ['hospitality-management', 'communication', 'english', 'teamwork'], ['Bagaimana Anda menjawab pertanyaan sejarah atau budaya yang belum dapat dipastikan?', 'Apa cara Anda menjaga kelompok tetap aman ketika rute ramai atau kondisi berubah?'], 6_800_000, 'Jadwal mengikuti kalender tur, sering dimulai pagi dan dapat mencakup akhir pekan.'),
    family('tour-operations', ['Asisten Operasi Tur', 'Koordinator Operasi Kegiatan', 'Manajer Operasi Tur'], 'menyelaraskan jadwal tamu, pemandu, kendaraan, dan operator lokal agar kegiatan berlangsung sesuai rencana yang aman.', ['membuat daftar kesiapan harian untuk peserta, pemandu, transportasi, dan mitra kegiatan', 'memeriksa cuaca, kapasitas, kondisi titik kumpul, serta perlengkapan sebelum keberangkatan', 'mengomunikasikan perubahan jadwal kepada tamu dan mitra melalui kanal yang telah disepakati'], ['memiliki pengalaman operasional perjalanan, acara, atau layanan lapangan', 'mampu menyusun rencana cadangan dan melakukan serah-terima yang lengkap', 'mampu mengambil keputusan operasional tanpa mengabaikan keselamatan peserta'], ['pernah mengoordinasikan tur kelompok atau kegiatan luar ruang', 'mampu menggunakan spreadsheet atau sistem jadwal'], ['hospitality-management', 'project-management', 'problem-solving', 'communication'], ['Bagaimana Anda menentukan kegiatan perlu ditunda ketika cuaca memburuk?', 'Informasi apa yang wajib diterima pemandu sebelum membawa tamu ke lokasi?'], 7_200_000, 'Jadwal bergiliran mengikuti keberangkatan kegiatan dan kondisi operasional lokasi.'),
    family('snorkeling-guide', ['Asisten Pemandu Snorkeling', 'Pemandu Aktivitas Bahari', 'Koordinator Wisata Bahari'], 'mendukung kegiatan bahari dengan briefing perlengkapan, pemantauan peserta, serta komunikasi rutin dengan operator dan pemandu utama.', ['memeriksa daftar peserta, ukuran alat, kondisi perlengkapan, dan kesiapan titik masuk air', 'menjelaskan batas area, sinyal komunikasi, aturan bersama satwa, dan prosedur kembali ke darat', 'memantau kondisi peserta sepanjang aktivitas dan segera meminta bantuan jika muncul risiko'], ['mampu berenang dengan baik dan siap bekerja di lingkungan laut', 'memahami briefing keselamatan serta tidak melampaui kompetensi atau batas kondisi laut', 'mampu menjaga komunikasi yang tenang dengan peserta dan pemandu utama'], ['memiliki sertifikat pertolongan pertama atau penyelamatan air yang masih berlaku', 'memiliki pengalaman memandu snorkeling dengan operator berizin'], ['hospitality-management', 'teamwork', 'communication', 'problem-solving'], ['Apa pemeriksaan kesiapan yang Anda lakukan sebelum peserta masuk ke air?', 'Apa yang Anda lakukan jika peserta menunjukkan kelelahan atau kecemasan saat aktivitas berlangsung?'], 7_000_000, 'Jadwal bergantung pada kondisi laut, waktu pasang, dan kalender kegiatan.'),
    family('coastal-safety', ['Petugas Keselamatan Aktivitas Pantai', 'Pengawas Aktivitas Pantai', 'Koordinator Keselamatan Pesisir'], 'mencegah insiden melalui pemeriksaan lokasi, briefing peserta, pemantauan kondisi, dan kesiapan eskalasi darurat.', ['memeriksa tanda bahaya, akses keluar, perlengkapan keselamatan, dan perubahan kondisi pantai', 'menjelaskan batas aktivitas dan prosedur berhenti kepada tamu serta mitra', 'mencatat kejadian atau kondisi nyaris celaka dan mengusulkan tindak pencegahan'], ['memiliki kemampuan berenang dan pelatihan pertolongan pertama atau penyelamatan air yang sesuai', 'mampu menghentikan kegiatan ketika kondisi tidak aman dan memberi instruksi tegas', 'siap bekerja di bawah matahari serta mengikuti prosedur pelaporan insiden'], ['memegang sertifikasi penyelamatan air yang masih berlaku', 'memiliki pengalaman pengawasan aktivitas rekreasi atau pantai'], ['problem-solving', 'communication', 'teamwork', 'hospitality-management'], ['Bagaimana Anda menjelaskan penghentian aktivitas kepada tamu ketika kondisi pantai berubah?', 'Apa informasi yang Anda catat setelah kejadian nyaris celaka?'], 7_500_000, 'Penugasan lapangan mengikuti jam aktivitas pantai; jadwal dapat berubah sesuai cuaca.'),
    family('boat-operations', ['Kru Pendukung Kapal Wisata', 'Mualim Kapal Wisata', 'Nakhoda Kapal Wisata'], 'mendukung perjalanan laut yang tertib dengan pemeriksaan kapal, briefing penumpang, dan koordinasi selama perjalanan.', ['memeriksa daftar penumpang, perlengkapan keselamatan, bahan bakar, dan catatan pemeriksaan sebelum berangkat', 'menjelaskan tata naik-turun kapal dan penggunaan alat keselamatan kepada penumpang', 'mencatat kondisi perjalanan serta melaporkan kelainan mesin atau cuaca kepada penanggung jawab armada'], ['memiliki pengalaman kerja kapal atau siap menjalani pelatihan untuk peran pendukung', 'mengikuti instruksi keselamatan, menjaga hitungan penumpang, dan bekerja sebagai kru', 'untuk peran mualim atau nakhoda, memiliki dokumen kompetensi dan pelayaran yang sesuai jenis kapal'], ['memiliki sertifikat pertolongan pertama atau keselamatan laut yang masih berlaku', 'berpengalaman mengoperasikan kapal wisata dengan rute pesisir'], ['hospitality-management', 'teamwork', 'problem-solving', 'communication'], ['Apa yang harus Anda periksa sebelum penumpang naik ke kapal?', 'Bagaimana Anda merespons jika cuaca berubah setelah kapal berada di perjalanan?'], 8_000_000, 'Jam kerja mengikuti jadwal pelayaran, kondisi laut, dan pemeriksaan kapal sebelum keberangkatan.'),
    family('marine-equipment', ['Petugas Perlengkapan Aktivitas Bahari', 'Teknisi Peralatan Wisata Bahari', 'Supervisor Pemeliharaan Peralatan'], 'menjaga perlengkapan kegiatan bahari bersih, terawat, sesuai ukuran, dan tidak digunakan ketika ada kerusakan.', ['menghitung dan memeriksa masker, snorkel, pelampung, fin, serta perlengkapan pendukung setelah penggunaan', 'membersihkan dan mengeringkan alat sesuai bahan serta prosedur penyimpanan', 'mengisolasi alat rusak, mencatat kondisinya, dan mengoordinasikan perbaikan atau penggantian'], ['teliti melakukan pemeriksaan fisik serta pencatatan inventaris', 'mampu mengikuti prosedur pembersihan dan penyimpanan alat yang bersentuhan dengan tamu', 'memahami bahwa alat dengan kerusakan keselamatan tidak boleh digunakan'], ['pernah menangani perlengkapan olahraga air atau peralatan rekreasi', 'memiliki keterampilan perawatan dasar bahan karet dan plastik'], ['hospitality-management', 'supply-chain', 'problem-solving', 'teamwork'], ['Apa langkah Anda saat menemukan kerusakan kecil pada perlengkapan keselamatan?', 'Bagaimana Anda menjaga alat siap pakai saat beberapa kelompok kembali bersamaan?'], 6_600_000, 'Jadwal mengikuti arus penggunaan alat dan pemeriksaan sebelum serta sesudah kegiatan.'),
    family('guest-transport', ['Pengemudi Antar-Jemput Tamu', 'Koordinator Armada Wisata', 'Supervisor Transportasi Tamu'], 'memberikan perjalanan tamu yang aman, tepat waktu, dan jelas titik penjemputannya.', ['memeriksa rute, kondisi kendaraan, dokumen operasional, serta waktu keberangkatan sebelum bertugas', 'mengonfirmasi identitas dan titik jemput kepada tamu melalui saluran resmi', 'mencatat perjalanan, jarak, biaya operasional, dan kondisi kendaraan setelah digunakan'], ['memiliki SIM yang sesuai dengan kendaraan yang dikemudikan dan catatan berkendara aman', 'mampu berkomunikasi sopan serta memahami navigasi rute Bali', 'siap mengikuti jadwal pagi, malam, atau perubahan penerbangan'], ['berpengalaman mengemudi untuk layanan tamu atau pariwisata', 'mampu berkomunikasi dasar dalam bahasa Inggris'], ['hospitality-management', 'communication', 'problem-solving', 'teamwork'], ['Apa yang Anda lakukan ketika titik jemput sulit ditemukan oleh tamu?', 'Bagaimana Anda mengatur perjalanan saat terjadi perubahan jadwal penerbangan?'], 6_800_000, 'Jadwal dapat mencakup pagi dini hari, malam, akhir pekan, dan waktu kedatangan tamu.'),
    family('airport-port-arrivals', ['Petugas Layanan Kedatangan', 'Koordinator Layanan Bandara dan Pelabuhan', 'Supervisor Layanan Transfer'], 'membuat proses penjemputan di bandara atau pelabuhan mudah ditemukan, terkonfirmasi, dan terkendali.', ['memantau jadwal kedatangan dan perubahan waktu bersama tim transportasi', 'memastikan papan nama atau instruksi temu mengikuti kebijakan lokasi dan kesepakatan dengan tamu', 'menghubungi tamu jika ada keterlambatan serta memberikan pilihan tindak lanjut yang jelas'], ['memiliki pengalaman layanan tamu, perjalanan, atau operasional penjemputan', 'mampu mengelola beberapa jadwal dan menjaga komunikasi tertulis tetap akurat', 'mampu bekerja di area ramai dan mematuhi ketentuan lokasi penjemputan'], ['mampu berbicara dalam bahasa Inggris dasar hingga menengah', 'pernah mengatur layanan untuk rombongan dan penerbangan terlambat'], ['hospitality-management', 'customer-support', 'communication', 'english'], ['Bagaimana Anda menemukan tamu ketika ada perubahan terminal atau pintu kedatangan?', 'Apa informasi yang Anda kirim agar tamu dapat mengenali titik jemput dengan mudah?'], 6_500_000, 'Jadwal mengikuti penerbangan dan pelayaran; beberapa giliran dapat dimulai pagi atau malam.'),
    family('trip-support-incidents', ['Petugas Dukungan Perjalanan', 'Spesialis Penanganan Kendala Perjalanan', 'Koordinator Respons Insiden Tamu'], 'membantu tamu dan tim lapangan menyelesaikan perubahan atau kendala perjalanan dengan informasi yang akurat dan prioritas keselamatan.', ['menerima laporan tamu dan mencatat waktu, lokasi, pihak yang terlibat, serta kebutuhan mendesak', 'menghubungi pemandu, transportasi, atau mitra untuk mengonfirmasi keadaan sebelum menawarkan pilihan', 'mengeskalasi isu keselamatan, kesehatan, kehilangan barang, atau konflik kepada penanggung jawab yang tepat'], ['memiliki pengalaman layanan pelanggan atau dukungan perjalanan', 'mampu berkomunikasi tenang, menjaga privasi, dan mencatat percakapan secara objektif', 'memahami jalur eskalasi dan tidak memberi janji yang belum dikonfirmasi'], ['pernah menangani keluhan atau perubahan layanan saat bepergian', 'mampu melayani pesan dalam bahasa Inggris'], ['customer-support', 'problem-solving', 'communication', 'english'], ['Bagaimana Anda memilah laporan yang membutuhkan bantuan segera dari pertanyaan rutin?', 'Informasi apa yang Anda sampaikan sebelum alternatif perjalanan dikonfirmasi mitra?'], 6_800_000, 'Jadwal rotasi mengikuti jam layanan dan kegiatan lapangan; respons di luar jam dapat dijadwalkan.'),
    family('local-partnerships', ['Petugas Relasi Mitra Lokal', 'Spesialis Kemitraan Akomodasi', 'Koordinator Relasi Mitra'], 'membangun kerja sama yang transparan dengan penginapan, pemandu, operator bahari, dan usaha komunitas.', ['mengumpulkan informasi kapasitas, standar layanan, harga, jadwal, dan kontak operasional mitra', 'menjelaskan ruang lingkup pemesanan, mekanisme konfirmasi, serta proses umpan balik kepada mitra', 'meninjau masalah layanan bersama mitra dan mencatat kesepakatan perbaikannya'], ['memiliki pengalaman kemitraan, pengadaan layanan, atau pengelolaan akun', 'mampu bernegosiasi dengan jelas dan mendokumentasikan kesepakatan secara tertulis', 'bersedia melakukan kunjungan serta menghormati cara kerja dan konteks komunitas lokal'], ['pernah bekerja dengan pelaku pariwisata atau akomodasi di Bali', 'mampu menyiapkan ringkasan kinerja mitra dalam spreadsheet'], ['hospitality-management', 'sales', 'communication', 'excel'], ['Bagaimana Anda menangani mitra yang kapasitasnya berubah setelah pemesanan diterima?', 'Informasi apa yang perlu disepakati sebelum layanan mitra ditawarkan kepada tamu?'], 7_000_000, 'Jam kerja mencakup pertemuan dan kunjungan mitra di Denpasar serta kawasan pesisir.'),
    family('groups-events', ['Konsultan Perjalanan Rombongan', 'Spesialis Perjalanan Grup', 'Koordinator Tur Perusahaan dan Acara'], 'merancang perjalanan rombongan dengan pembagian tanggung jawab, batas kapasitas, jadwal, dan konfirmasi biaya yang jelas.', ['menggali tujuan, ukuran rombongan, anggaran, rentang waktu, serta kebutuhan peserta', 'menyusun urutan layanan dan mengonfirmasi kapasitas pemandu, penginapan, kendaraan, serta lokasi', 'membuat lembar operasional yang memuat kontak darurat, titik kumpul, dan alternatif kegiatan'], ['memiliki pengalaman perjalanan grup, acara, atau layanan korporat', 'mampu membuat rencana kerja dengan tenggat dan penanggung jawab', 'teliti terhadap daftar peserta, kebutuhan aksesibilitas, dan perubahan jadwal'], ['pernah mengelola perjalanan insentif, rapat, atau kelompok sekolah', 'mampu menyusun penawaran serta presentasi ringkas'], ['project-management', 'hospitality-management', 'sales', 'communication'], ['Bagaimana Anda mengatur perubahan jumlah peserta menjelang keberangkatan?', 'Apa yang Anda lakukan untuk memastikan kebutuhan peserta diterima oleh setiap mitra?'], 7_200_000, 'Jam kerja mengikuti tahap penjualan, persiapan, serta pelaksanaan kegiatan kelompok.'),
    family('destination-product', ['Penyusun Paket Wisata Lokal', 'Spesialis Kurasi Pengalaman', 'Manajer Produk Wisata'], 'membentuk paket wisata yang mempunyai ruang lingkup layanan jelas, layak dijalankan mitra, dan sesuai informasi destinasi.', ['menilai minat tamu, akses lokasi, durasi, musim, serta batas kapasitas sebelum merancang paket', 'mengumpulkan harga dan detail operasional dari mitra lalu menghitung komponen penawaran', 'memperbarui informasi paket saat ada perubahan aturan, jam, atau ketersediaan lokasi'], ['memiliki pengalaman produk wisata, perjalanan, atau pemasaran layanan', 'mampu membandingkan informasi mitra dan menyimpan sumber serta tanggal konfirmasinya', 'menulis deskripsi produk yang menarik tanpa klaim berlebihan'], ['mengenal destinasi pesisir Bali dan pelaku komunitas setempat', 'pernah melakukan uji coba pengalaman atau evaluasi paket'], ['hospitality-management', 'product-management', 'data-analysis', 'communication'], ['Bagaimana Anda memastikan paket wisata tetap realistis dari sisi waktu tempuh dan kapasitas?', 'Informasi apa yang perlu diverifikasi sebelum materi paket diterbitkan?'], 7_500_000, 'Jam kerja utama di kantor Denpasar dengan kunjungan lokasi dan mitra secara berkala.'),
    family('responsible-tourism', ['Pemandu Edukasi Lingkungan', 'Fasilitator Wisata Bertanggung Jawab', 'Koordinator Program Wisata Komunitas'], 'mendampingi pengalaman yang mengedukasi tamu sekaligus menghormati lingkungan dan aturan komunitas di lokasi.', ['menyiapkan penjelasan tentang ekosistem pesisir dari sumber yang dapat dipertanggungjawabkan', 'memberi briefing perilaku ramah lingkungan dan mengarahkan kelompok mengikuti batas area', 'mengumpulkan umpan balik warga dan peserta melalui jalur yang disepakati'], ['memiliki pengalaman pemanduan, edukasi lingkungan, atau kegiatan komunitas', 'mampu menyampaikan informasi tanpa membesar-besarkan dampak wisata', 'siap bekerja di lapangan dan menghormati arahan pengelola lokasi'], ['pernah bekerja dengan program konservasi atau wisata berbasis komunitas', 'memahami dasar keselamatan pengunjung di ruang luar'], ['hospitality-management', 'communication', 'teamwork', 'english'], ['Bagaimana Anda meminta tamu mengubah perilaku yang berpotensi mengganggu satwa atau warga?', 'Bagaimana Anda memastikan materi edukasi tidak menyampaikan fakta yang belum terverifikasi?'], 6_900_000, 'Jadwal mengikuti kegiatan lapangan dan agenda mitra komunitas.'),
    family('operations-control', ['Petugas Pemantau Cuaca dan Rencana Alternatif', 'Koordinator Kendali Operasi Tur', 'Manajer Kendali Operasional'], 'menyediakan gambaran kesiapan operasional harian dan membantu tim memilih langkah saat cuaca atau kapasitas berubah.', ['memantau sumber informasi cuaca dan pemberitahuan lokasi yang relevan dengan kegiatan terjadwal', 'memperbarui status pemandu, transportasi, kapasitas mitra, serta perlengkapan dalam papan kendali harian', 'menyampaikan opsi penundaan, penggantian, atau pembatalan kepada penanggung jawab untuk keputusan akhir'], ['teliti mengumpulkan informasi dari beberapa tim dan mencatat waktu pembaruannya', 'mampu menggunakan spreadsheet atau alat penjadwalan', 'memahami bahwa keputusan keselamatan harus mengikuti sumber dan kewenangan yang tepat'], ['pernah membantu pusat operasi, dispatch, atau penjadwalan lapangan', 'mampu meringkas perubahan menjadi laporan singkat'], ['data-analysis', 'excel', 'problem-solving', 'communication'], ['Bagaimana Anda memastikan informasi cuaca yang diteruskan masih relevan dengan jadwal tur?', 'Apa elemen yang Anda masukkan ke laporan perubahan operasi harian?'], 7_000_000, 'Jadwal dapat dimulai sebelum kegiatan pertama dan mengikuti sistem giliran operasi.'),
    family('accommodation-service', ['Petugas Pemesanan Layanan Penginapan', 'Koordinator Layanan Akomodasi', 'Supervisor Kemitraan Penginapan'], 'mengelola permintaan akomodasi dan memastikan rincian layanan yang dijanjikan sesuai konfirmasi dari pihak penginapan.', ['mengumpulkan tanggal menginap, jumlah tamu, kebutuhan kamar, serta preferensi yang relevan', 'mengonfirmasi tipe kamar, kebijakan check-in, biaya, dan batas waktu pembayaran dengan mitra', 'mengirim ringkasan tertulis kepada tamu dan mencatat perubahan atau permintaan khusus'], ['memiliki pengalaman reservasi hotel atau administrasi layanan tamu', 'teliti pada tanggal, nama tamu, tipe kamar, dan ketentuan pembatalan', 'mampu menangani informasi pribadi dengan aman'], ['pernah menggunakan sistem reservasi penginapan', 'mampu berkomunikasi dalam bahasa Inggris tertulis'], ['hospitality-management', 'customer-support', 'excel', 'communication'], ['Bagaimana Anda menindaklanjuti jika mitra belum mengonfirmasi tipe kamar yang diminta?', 'Apa informasi yang perlu disampaikan sebelum tamu menerima konfirmasi pemesanan?'], 6_500_000, 'Jam kerja mengikuti waktu layanan reservasi dan konfirmasi penginapan.'),
    family('destination-content', ['Pengelola Informasi Destinasi', 'Spesialis Komunikasi Destinasi', 'Koordinator Konten dan Edukasi Wisata'], 'menjaga informasi rute, aktivitas, dan aturan destinasi yang dibagikan kepada tamu tetap jelas, aktual, dan terverifikasi.', ['mengumpulkan pembaruan jam, akses, aturan, harga, dan kontak dari sumber resmi atau pengelola lokasi', 'menulis informasi praktis untuk pesan konfirmasi, panduan digital, dan materi briefing', 'meninjau pertanyaan berulang dari tamu dan memperbarui jawaban standar bersama operasi'], ['memiliki pengalaman penulisan konten, informasi pariwisata, atau komunikasi pelanggan', 'mampu membedakan informasi terverifikasi dari asumsi dan mencantumkan sumber internal', 'teliti menyunting tanggal, istilah, dan instruksi keselamatan'], ['mampu menulis dalam bahasa Inggris atau bahasa tambahan', 'pernah mengelola panduan digital atau basis pengetahuan layanan'], ['content-writing', 'hospitality-management', 'communication', 'english'], ['Bagaimana Anda memeriksa bahwa informasi akses destinasi masih berlaku?', 'Apa yang Anda lakukan ketika sumber berbeda memberikan aturan yang tidak sama?'], 6_700_000, 'Jam kerja utama di kantor Denpasar dengan sesekali kunjungan ke destinasi dan mitra.'),
    family('travel-administration', ['Petugas Administrasi Perjalanan', 'Analis Administrasi Tur', 'Supervisor Administrasi dan Rekonsiliasi'], 'menjaga dokumen reservasi, bukti pembayaran, transaksi mitra, dan biaya perjalanan tertata untuk pemeriksaan internal.', ['mencocokkan invoice mitra dengan reservasi, bukti layanan, dan persetujuan biaya', 'memperbarui rekap perjalanan serta menandai dokumen yang masih kurang', 'menyimpan dokumen berdasarkan akses yang diizinkan dan jadwal retensi perusahaan'], ['memiliki pengalaman administrasi transaksi atau perjalanan', 'mampu menggunakan spreadsheet dan menjaga ketelitian angka', 'memahami kerahasiaan data tamu serta prosedur persetujuan pembayaran'], ['pernah membantu rekonsiliasi biaya operasional', 'memiliki pengalaman menggunakan sistem akuntansi atau pemesanan'], ['excel', 'problem-solving', 'communication', 'hospitality-management'], ['Bagaimana Anda menindaklanjuti invoice mitra yang tidak cocok dengan bukti pemesanan?', 'Apa cara Anda memastikan dokumen tamu hanya dibagikan kepada pihak yang berwenang?'], 6_500_000, 'Jam kerja kantor dengan tenggat administrasi setelah kegiatan dan periode rekonsiliasi.'),
  ],
  'pangan-kita-nusantara': [
    family('ready-to-cook-line', ['Operator Lini Produk Siap Masak', 'Teknisi Proses Siap Masak', 'Koordinator Produksi Siap Masak'], 'menjaga produksi produk siap masak berjalan sesuai takaran, parameter proses, target harian, dan standar keamanan pangan.', ['menyiapkan area dan bahan berdasarkan jadwal produksi serta identitas lot', 'mengoperasikan tahapan pencampuran, pemasakan, atau pembentukan sesuai instruksi kerja', 'mencatat hasil, waktu proses, dan penghentian lini untuk ditinjau oleh supervisor'], ['memiliki pengalaman produksi pangan atau kesiapan mengikuti pelatihan kerja', 'mampu membaca instruksi dan melakukan pencatatan proses dengan teliti', 'memahami penggunaan alat pelindung diri dan aturan higiene personal'], ['pernah bekerja dengan sistem batch atau lini produksi', 'memahami dasar GMP atau HACCP'], ['food-safety', 'teamwork', 'problem-solving', 'supply-chain'], ['Bagaimana Anda merespons jika parameter proses keluar dari batas yang ditentukan?', 'Informasi apa yang harus tercatat ketika terjadi penghentian lini?'], 6_500_000, 'Jadwal sistem giliran mengikuti rencana produksi; area kerja mengharuskan kepatuhan higiene.'),
    family('raw-material-prep', ['Petugas Persiapan Bahan Pangan', 'Teknisi Penyiapan Bahan', 'Supervisor Persiapan Bahan'], 'memastikan bahan segar dibersihkan, dipilah, dan disiapkan sesuai spesifikasi sebelum masuk ke proses produksi.', ['memeriksa identitas lot, kondisi fisik, dan kebersihan bahan sebelum persiapan', 'menimbang atau memotong bahan sesuai ukuran dan formula yang tercantum', 'memisahkan bahan yang tidak sesuai serta meminta verifikasi sebelum digunakan'], ['memahami penanganan bahan pangan segar dan risiko kontaminasi silang', 'mampu menimbang bahan dengan akurat dan mengikuti urutan proses', 'siap bekerja pada area basah, dingin, atau bersuhu ruang sesuai prosedur'], ['pernah menangani bahan hasil pertanian atau produk pangan segar', 'memahami rotasi FIFO dan pencatatan lot'], ['food-safety', 'supply-chain', 'teamwork', 'problem-solving'], ['Apa yang Anda periksa ketika bahan segar tiba sebelum masuk area persiapan?', 'Bagaimana Anda memisahkan bahan yang belum lulus pemeriksaan?'], 6_500_000, 'Jadwal mengikuti penerimaan bahan pagi dan urutan batch produksi.'),
    family('production-sanitation', ['Petugas Sanitasi Area Produksi', 'Teknisi Sanitasi Pangan', 'Supervisor Sanitasi Produksi'], 'menyiapkan peralatan dan ruang produksi yang bersih sebelum, selama, serta setelah pergantian produk.', ['melaksanakan jadwal pembersihan berdasarkan area, alat, dan jenis produk', 'memeriksa konsentrasi atau cara penggunaan bahan pembersih sesuai petunjuk internal', 'mencatat hasil sanitasi serta mengeskalasi kondisi yang berisiko terhadap keamanan pangan'], ['mampu mengikuti prosedur keselamatan saat menggunakan bahan pembersih', 'memahami pemisahan alat bersih dan alat yang belum dibersihkan', 'teliti mengisi daftar periksa dan siap bekerja sesuai giliran produksi'], ['pernah bekerja pada sanitasi industri pangan', 'memahami validasi atau verifikasi pembersihan'], ['food-safety', 'teamwork', 'communication', 'problem-solving'], ['Apa langkah yang Anda lakukan sebelum mengembalikan alat ke lini setelah dibersihkan?', 'Bagaimana Anda menangani temuan residu atau kondisi sanitasi yang belum memenuhi standar?'], 6_600_000, 'Jadwal dapat mencakup pergantian shift dan pembersihan setelah produksi selesai.'),
    family('incoming-qc', ['Inspektur Mutu Bahan Masuk', 'Analis Mutu Proses Pangan', 'Supervisor Pengendalian Mutu'], 'memastikan bahan baku dan produk antara memenuhi kriteria penerimaan yang terdokumentasi sebelum proses berlanjut.', ['mengambil sampel sesuai rencana pemeriksaan serta menjaga identitas sampel tetap tertelusur', 'memeriksa kondisi, ukuran, suhu, label, atau parameter mutu yang ditetapkan', 'mencatat hasil dan menahan bahan yang belum memenuhi kriteria sampai ada keputusan berwenang'], ['memiliki pengalaman kontrol mutu, laboratorium, atau penerimaan bahan pangan', 'teliti melakukan sampling dan mencatat hasil tanpa mengubah data', 'mampu menjelaskan temuan kepada pembelian, gudang, dan produksi secara objektif'], ['pernah menggunakan alat ukur mutu pangan', 'memahami prinsip HACCP atau audit pemasok'], ['food-safety', 'qa-testing', 'data-analysis', 'communication'], ['Bagaimana Anda menjaga sampel tetap terhubung dengan lot asalnya?', 'Apa yang Anda lakukan ketika hasil pemeriksaan berada dekat batas spesifikasi?'], 7_000_000, 'Jadwal mencakup penerimaan bahan dan pemeriksaan selama beberapa giliran produksi.'),
    family('quality-assurance', ['Petugas Dokumen Jaminan Mutu', 'Spesialis Sistem Mutu Pangan', 'Manajer Jaminan Mutu Pangan'], 'menjaga prosedur, catatan batch, dan tindak lanjut penyimpangan tersusun sehingga proses dapat ditelusuri dan diaudit.', ['memeriksa kelengkapan catatan produksi dan versi formulir yang digunakan', 'mengelola daftar penyimpangan serta memantau status tindakan koreksi dan pencegahan', 'mendukung persiapan audit internal atau pemasok dengan bukti yang relevan'], ['memiliki pengalaman dokumentasi mutu atau operasional pangan', 'mampu mengendalikan versi dokumen dan menjaga jejak perubahan', 'memahami kerahasiaan catatan serta pentingnya data yang akurat dan tepat waktu'], ['pernah mendampingi audit keamanan pangan', 'mengenal HACCP, GMP, atau sistem mutu yang sejenis'], ['food-safety', 'excel', 'communication', 'leadership'], ['Bagaimana Anda memastikan perubahan prosedur digunakan oleh seluruh giliran kerja?', 'Bukti apa yang Anda cari saat menindaklanjuti tindakan koreksi yang terlambat?'], 7_500_000, 'Jam kerja utama kantor mutu dengan kunjungan berkala ke area produksi.'),
    family('food-lab', ['Analis Laboratorium Pangan', 'Analis Mikrobiologi Pangan', 'Koordinator Laboratorium Pangan'], 'menghasilkan hasil pengujian yang dapat ditelusuri untuk mendukung keputusan mutu bahan dan produk.', ['menyiapkan sampel, media, reagen, serta alat sesuai metode kerja laboratorium', 'melaksanakan pengujian fisik, kimia, atau mikrobiologi sesuai kompetensi dan prosedur', 'memeriksa kontrol, mencatat hasil, dan melaporkan hasil di luar spesifikasi kepada penanggung jawab'], ['memiliki pendidikan atau pengalaman laboratorium pangan yang relevan', 'mampu menjaga kebersihan area dan mencegah kontaminasi silang', 'teliti mengelola identitas sampel, tanggal, kondisi, serta hasil pengujian'], ['pernah menggunakan alat uji laboratorium pangan', 'memahami kalibrasi dan pencatatan bahan standar'], ['food-safety', 'qa-testing', 'data-analysis', 'problem-solving'], ['Bagaimana Anda memastikan sampel dan hasil uji tidak tertukar?', 'Apa tindakan Anda jika kontrol pengujian tidak berada dalam rentang yang diterima?'], 7_200_000, 'Jadwal disesuaikan dengan waktu penerimaan sampel dan rencana produksi.'),
    family('packaging-machinery', ['Teknisi Pengemasan Pangan', 'Teknisi Set-up Mesin Pengemasan', 'Supervisor Pengemasan'], 'menjaga kemasan produk utuh, tersegel, terbaca, dan siap didistribusikan dengan pengaturan mesin yang tepat.', ['menyiapkan bahan kemasan berdasarkan jenis produk dan jadwal pengemasan', 'memeriksa segel, kode produksi, berat bersih, dan posisi label pada sampel berkala', 'mencatat pengaturan mesin, jumlah hasil, dan gangguan selama proses'], ['memiliki pengalaman mesin pengemasan atau produksi pangan', 'mampu melakukan pemeriksaan visual dan mengisi catatan proses', 'memahami aturan keselamatan saat membersihkan atau menyetel mesin'], ['pernah menangani mesin sealer, filler, atau labeler', 'mengenal perawatan mandiri dan pengurangan kemasan rusak'], ['food-safety', 'problem-solving', 'teamwork', 'electrical-engineering'], ['Apa penyebab umum segel kemasan gagal dan bagaimana Anda memeriksanya?', 'Bagaimana Anda memastikan kode produksi terbaca pada setiap batch?'], 6_800_000, 'Jadwal mengikuti produksi dan dapat berganti shift pada saat permintaan meningkat.'),
    family('label-traceability', ['Petugas Label dan Ketertelusuran', 'Spesialis Label Produk Pangan', 'Koordinator Kepatuhan Label'], 'menjaga informasi pada label, kode produksi, dan catatan lot konsisten dengan spesifikasi produk yang disetujui.', ['mencocokkan naskah label dan kode batch dengan daftar produk yang dijadwalkan', 'memeriksa nama produk, komposisi, berat, tanggal, dan informasi yang telah disetujui internal', 'menelusuri hubungan lot bahan dengan batch produk saat pemeriksaan atau penarikan simulasi'], ['teliti membandingkan informasi antara dokumen, kemasan, dan catatan sistem', 'mampu mengelola versi label dan mencegah penggunaan materi yang sudah kedaluwarsa', 'menjaga kerahasiaan formula serta segera mengeskalasi ketidaksesuaian'], ['pernah bekerja di kontrol dokumen, QA, atau pelabelan pangan', 'memahami ketertelusuran lot dan kesiapan penarikan produk'], ['food-safety', 'excel', 'communication', 'problem-solving'], ['Bagaimana Anda memastikan label yang dipasang sesuai dengan produk yang sedang dikemas?', 'Langkah apa yang Anda ambil jika kode lot tidak dapat ditelusuri ke bahan asal?'], 7_000_000, 'Jadwal mengikuti perubahan jadwal produksi dan penggantian label antarproduk.'),
    family('warehouse-inventory', ['Petugas Gudang Bahan Pangan', 'Pengendali Persediaan Pangan', 'Supervisor Gudang Pangan'], 'menjaga penerimaan, penyimpanan, dan pengeluaran bahan pangan akurat serta sesuai batas penanganannya.', ['memeriksa dokumen dan kondisi barang saat penerimaan sebelum menempatkannya di lokasi simpan', 'menjaga pemisahan bahan, identitas lot, serta rotasi stok sesuai masa simpan', 'mencocokkan transaksi sistem dengan hitung fisik dan menginvestigasi selisih'], ['memiliki pengalaman gudang atau inventori, idealnya di industri pangan', 'mampu membaca label, melakukan pencatatan, dan memakai alat bantu stok', 'memahami prosedur keselamatan saat mengangkat atau memindahkan barang'], ['pernah menggunakan sistem inventori atau pemindai barcode', 'mengenal FIFO/FEFO dan pengendalian stok bahan sensitif'], ['supply-chain', 'excel', 'food-safety', 'teamwork'], ['Bagaimana Anda menentukan urutan pengeluaran stok dengan tanggal kedaluwarsa berbeda?', 'Apa langkah Anda ketika stok fisik berbeda dari saldo sistem?'], 6_700_000, 'Jadwal mengikuti kedatangan bahan, rencana produksi, serta kebutuhan gudang dingin.'),
    family('cold-chain', ['Petugas Rantai Dingin Pangan', 'Teknisi Pendingin Produksi', 'Koordinator Rantai Dingin'], 'memastikan bahan dan produk sensitif suhu ditangani dalam rentang penyimpanan yang ditetapkan.', ['memeriksa dan mencatat suhu ruang, chiller, freezer, atau kendaraan pada jadwal pemeriksaan', 'memastikan pintu, rak, sensor, dan pemisahan produk berfungsi sesuai prosedur', 'mengisolasi produk terdampak penyimpangan suhu dan mengeskalasi untuk penilaian mutu'], ['memiliki pengalaman gudang dingin, logistik pangan, atau fasilitas pendingin', 'teliti mengisi catatan suhu dan tidak mengubah hasil pemantauan', 'memahami prosedur eskalasi ketika batas suhu terlampaui'], ['pernah melakukan pemeriksaan logger suhu atau kalibrasi sensor', 'memiliki keterampilan dasar pemeliharaan refrigerasi'], ['supply-chain', 'food-safety', 'problem-solving', 'electrical-engineering'], ['Apa yang Anda lakukan ketika alarm suhu berbunyi di luar jam penerimaan barang?', 'Informasi apa yang diperlukan sebelum produk terdampak dapat dilepas kembali?'], 7_200_000, 'Jadwal pemeriksaan bergilir mengikuti operasi fasilitas dingin dan pengiriman produk.'),
    family('production-planning', ['Penjadwal Produksi Pangan', 'Perencana Produksi dan Persediaan', 'Koordinator Perencanaan Produksi'], 'menyelaraskan pesanan, kapasitas, ketersediaan bahan, dan waktu produksi agar komitmen pengiriman dapat dipenuhi.', ['mengumpulkan pesanan, perkiraan permintaan, stok, dan kapasitas lini untuk rencana mingguan', 'memperbarui urutan batch ketika ada perubahan bahan, perawatan, atau prioritas pelanggan', 'menyampaikan risiko keterlambatan dan kebutuhan keputusan kepada produksi serta penjualan'], ['memiliki pengalaman penjadwalan, perencanaan stok, atau administrasi produksi', 'mampu mengolah data dan menyampaikan asumsi dengan jelas', 'teliti terhadap ukuran batch, masa simpan, dan kebutuhan waktu sanitasi'], ['pernah menggunakan sistem ERP atau perencanaan produksi', 'memiliki pengalaman koordinasi lintas fungsi'], ['supply-chain', 'excel', 'data-analysis', 'communication'], ['Bagaimana Anda menentukan batch mana yang harus dijadwalkan lebih dulu saat bahan terbatas?', 'Apa data yang perlu dipastikan sebelum menjanjikan tanggal kirim kepada pelanggan?'], 7_500_000, 'Jam kerja utama kantor dengan koordinasi saat terjadi perubahan jadwal produksi.'),
    family('raw-material-buying', ['Petugas Pembelian Bahan Segar', 'Buyer Bahan Pangan', 'Koordinator Pengadaan Pangan'], 'menjaga pembelian bahan pangan memenuhi mutu, kuantitas, harga, jadwal, dan ketertelusuran yang diperlukan produksi.', ['mengumpulkan kebutuhan bahan dan menyusun permintaan penawaran kepada pemasok', 'memeriksa spesifikasi mutu, asal barang, harga, jadwal, dan dokumen pembelian', 'mengawal pengiriman serta menyelesaikan klaim bahan yang tidak memenuhi kesepakatan'], ['memiliki pengalaman pembelian, pengadaan, atau pasokan bahan pangan', 'mampu bernegosiasi secara profesional dan menyimpan bukti keputusan', 'siap berkomunikasi dengan pemasok serta menindaklanjuti perubahan ketersediaan'], ['memiliki jejaring pemasok di Jawa Timur', 'pernah mengevaluasi kinerja dan risiko pasokan pemasok'], ['supply-chain', 'sales', 'communication', 'excel'], ['Bagaimana Anda membandingkan penawaran harga dengan mutu dan risiko keterlambatan?', 'Apa yang Anda lakukan jika bahan dari pemasok utama tidak tersedia sesuai jadwal?'], 7_200_000, 'Jam kerja kantor dengan komunikasi pemasok dan kunjungan terjadwal ke area pasok.'),
    family('supplier-relations', ['Penghubung Pemasok Tani', 'Spesialis Pengembangan Pemasok', 'Koordinator Kemitraan Pemasok'], 'membangun pasokan yang dapat diprediksi bersama petani dan pemasok sambil menjaga spesifikasi serta kesepakatan tetap transparan.', ['menyampaikan standar bahan, rentang jumlah, kalender pembelian, dan cara penerimaan kepada mitra', 'mengumpulkan perkiraan panen atau kapasitas pasok dan memperbaruinya kepada tim perencana', 'mencatat kendala mutu atau pembayaran serta menghubungkan tindak lanjut dengan unit terkait'], ['memiliki pengalaman kemitraan, lapangan, pembelian, atau layanan pemasok', 'mampu menjelaskan kesepakatan tertulis dengan bahasa yang mudah dipahami', 'bersedia melakukan perjalanan ke sentra pasok dan membangun hubungan profesional'], ['pernah bekerja dengan koperasi, petani, atau pemasok lokal', 'mengenal praktik pengadaan yang bertanggung jawab'], ['supply-chain', 'communication', 'teamwork', 'problem-solving'], ['Bagaimana Anda menangani perubahan volume panen yang berpengaruh pada rencana produksi?', 'Informasi apa yang perlu dijelaskan kepada pemasok sebelum kontrak pasokan berjalan?'], 7_000_000, 'Kunjungan pemasok diatur sesuai musim panen dan kebutuhan tim produksi.'),
    family('equipment-maintenance', ['Teknisi Perawatan Mesin Pangan', 'Mekanik Mesin Produksi', 'Teknisi Senior Pemeliharaan'], 'mengurangi gangguan produksi melalui pemeriksaan rutin, perbaikan yang tercatat, dan serah-terima alat yang aman.', ['melaksanakan preventive maintenance sesuai jadwal dan daftar komponen kritis', 'menelusuri kerusakan mekanis serta melaporkan penyebab dan kebutuhan suku cadang', 'memastikan pelindung mesin terpasang dan area kerja bersih setelah perbaikan'], ['memiliki pengalaman pemeliharaan mesin industri atau peralatan pangan', 'mampu membaca panduan teknis dasar dan mengikuti prosedur isolasi energi', 'siap merespons gangguan dengan koordinasi bersama produksi dan keselamatan kerja'], ['memiliki keterampilan mekanik, pneumatik, atau conveyor', 'pernah mencatat riwayat perawatan dan analisis kerusakan berulang'], ['mechanical-design', 'problem-solving', 'teamwork', 'electrical-engineering'], ['Bagaimana Anda menentukan pemeriksaan awal ketika mesin berhenti di tengah batch?', 'Apa informasi yang perlu diserahkan kepada operator setelah perbaikan selesai?'], 7_500_000, 'Jadwal pemeliharaan mengikuti jam produksi; respons gangguan dilakukan melalui giliran teknis.'),
    family('utilities-technician', ['Teknisi Utilitas Pabrik', 'Teknisi Listrik dan Panel Produksi', 'Supervisor Utilitas Pabrik'], 'menjaga utilitas listrik, air, udara tekan, dan pendukung proses tersedia dalam kondisi aman serta terpantau.', ['memeriksa panel, pompa, kompresor, dan catatan pemakaian sesuai daftar inspeksi', 'mencatat gangguan atau perubahan parameter dan mengeskalasi risiko terhadap produksi', 'mengatur pekerjaan vendor dan memastikan izin kerja serta pengamanan area dipenuhi'], ['memiliki pendidikan atau pengalaman teknik listrik, mekanik, atau utilitas fasilitas', 'memahami prosedur keselamatan dan tidak melakukan pekerjaan di luar kompetensi', 'mampu membaca catatan teknis dan menyerahkan status fasilitas dengan jelas'], ['memiliki sertifikat kompetensi kelistrikan atau K3 yang relevan', 'pernah bekerja di pabrik makanan atau fasilitas beroperasi multi-shift'], ['electrical-engineering', 'problem-solving', 'teamwork', 'leadership'], ['Bagaimana Anda membedakan gangguan lokal dengan masalah utilitas yang berdampak luas?', 'Apa langkah yang Anda ambil sebelum mengizinkan pekerjaan pada panel atau mesin?'], 7_800_000, 'Jadwal pemantauan menyesuaikan operasi fasilitas dan dapat bergilir.'),
    family('food-product-development', ['Formulator Produk Pangan', 'Spesialis Pengembangan Produk', 'Koordinator Inovasi Produk Pangan'], 'mengembangkan produk siap masak yang dapat diproduksi berulang dengan rasa, biaya, dan parameter mutu yang terukur.', ['menyusun prototipe dan mencatat formula, urutan proses, serta perubahan setiap percobaan', 'mengkoordinasikan uji rasa, pengujian masa simpan awal, dan umpan balik lintas tim', 'menilai ketersediaan bahan dan kebutuhan proses sebelum rekomendasi peluncuran diajukan'], ['memiliki latar teknologi pangan, kuliner produk, atau pengalaman R&D pangan', 'mampu bekerja secara terukur dengan formula, batch kecil, dan dokumentasi', 'memahami keamanan pangan serta batas klaim produk yang dapat dibuat'], ['pernah mengembangkan produk siap masak atau makanan beku', 'memiliki pengalaman uji konsumen atau analisis biaya formula'], ['food-safety', 'data-analysis', 'problem-solving', 'supply-chain'], ['Bagaimana Anda merancang uji coba yang membedakan perubahan formula dari variasi proses?', 'Apa yang Anda tinjau sebelum memindahkan resep prototipe ke skala produksi?'], 8_500_000, 'Jam kerja utama R&D dengan koordinasi uji coba di area produksi.'),
    family('sensory-evaluation', ['Petugas Sampel dan Evaluasi Sensoris', 'Analis Evaluasi Sensoris Produk', 'Koordinator Uji Sensoris Pangan'], 'mengelola sampel dan sesi evaluasi agar masukan rasa, aroma, tekstur, dan tampilan tercatat konsisten.', ['menyiapkan kode sampel, urutan penyajian, serta lembar evaluasi tanpa membuka identitas produk', 'mengatur kondisi ruang dan instruksi penilaian agar peserta memahami metode yang sama', 'merangkum hasil dan menandai temuan yang memerlukan uji lanjutan'], ['memiliki ketelitian dalam penyiapan sampel dan dokumentasi data', 'mampu mengikuti metode evaluasi tanpa mengarahkan jawaban panelis', 'memahami kebersihan sampel dan deklarasi alergen sebelum sesi'], ['pernah membantu uji rasa atau riset konsumen', 'mampu mengolah hasil kuesioner sederhana'], ['food-safety', 'data-analysis', 'communication', 'excel'], ['Bagaimana Anda mencegah urutan penyajian memengaruhi penilaian panelis?', 'Apa yang Anda lakukan jika ada peserta melaporkan alergi sebelum sesi dimulai?'], 6_800_000, 'Jadwal mengikuti agenda uji produk dan persiapan sampel.'),
    family('foodservice-sales', ['Petugas Pengiriman Akun Kuliner', 'Pengelola Akun Food Service', 'Manajer Kemitraan Kuliner'], 'membantu restoran dan mitra ritel mendapatkan produk serta informasi pasok yang sesuai kebutuhan operasional mereka.', ['mengumpulkan kebutuhan produk, frekuensi pemesanan, dan standar penerimaan pelanggan', 'menyiapkan penawaran, memeriksa ketersediaan, dan mengoordinasikan waktu pengiriman', 'mengawal pertanyaan atau keluhan produk sampai jawaban lintas tim diterima pelanggan'], ['memiliki pengalaman penjualan B2B, layanan pelanggan, atau distribusi pangan', 'mampu membuat catatan akun dan menyampaikan ketersediaan produk secara akurat', 'bersedia mengunjungi pelanggan usaha di wilayah yang ditetapkan'], ['pernah melayani restoran, katering, hotel, atau toko pangan', 'mampu membaca laporan penjualan dan mempertahankan relasi pelanggan'], ['sales', 'customer-support', 'supply-chain', 'communication'], ['Bagaimana Anda menangani pelanggan yang membutuhkan produk di luar stok reguler?', 'Apa informasi yang Anda konfirmasi sebelum menyetujui jadwal pengiriman?'], 7_000_000, 'Kegiatan mencakup kunjungan pelanggan dan koordinasi kantor di Surabaya.'),
    family('consumer-care', ['Admin Pesanan Produk Pangan', 'Spesialis Layanan Konsumen Pangan', 'Koordinator Penanganan Keluhan'], 'memberi jawaban yang jelas kepada pelanggan dan menyalurkan laporan mutu dengan informasi yang cukup untuk ditindaklanjuti.', ['menerima pertanyaan tentang produk, penyimpanan, ketersediaan, dan pemesanan', 'mencatat nomor batch, tanggal pembelian, foto, serta kronologi keluhan sesuai izin pelanggan', 'menghubungkan kasus keamanan atau mutu ke tim QA dan memastikan pelanggan menerima pembaruan'], ['memiliki pengalaman layanan konsumen, administrasi pesanan, atau pusat kontak', 'mampu menulis jawaban yang empatik dan tidak menyampaikan klaim produk yang belum disetujui', 'menjaga kerahasiaan data pribadi dan mengikuti waktu tanggapan yang ditetapkan'], ['pernah memakai sistem tiket atau CRM', 'memahami prosedur dasar eskalasi keluhan produk pangan'], ['customer-support', 'communication', 'problem-solving', 'excel'], ['Informasi apa yang Anda perlukan untuk meneruskan laporan dugaan masalah mutu?', 'Bagaimana Anda memberi kabar kepada pelanggan ketika investigasi belum selesai?'], 6_500_000, 'Jadwal mengikuti jam layanan pelanggan dan rotasi pada periode pemesanan ramai.'),
    family('food-compliance-audit', ['Auditor Internal Kebersihan Pangan', 'Spesialis Kepatuhan Keamanan Pangan', 'Koordinator Audit dan Kepatuhan Pangan'], 'membantu memastikan praktik kebersihan, catatan, dan tindakan perbaikan diterapkan konsisten di area produksi.', ['melakukan inspeksi berbasis daftar periksa pada area, peralatan, kebersihan personel, dan penyimpanan', 'mencatat temuan dengan bukti yang memadai serta menyepakati pemilik dan tenggat tindak lanjut', 'meninjau efektivitas perbaikan pada pemeriksaan ulang dan melaporkan pola temuan berulang'], ['memiliki pengalaman keamanan pangan, QA, inspeksi, atau audit operasional', 'mampu menilai bukti secara objektif dan menyampaikan temuan secara profesional', 'memahami prinsip sanitasi, penelusuran batch, dan eskalasi risiko produk'], ['pernah mendampingi audit HACCP, GMP, atau sistem mutu pangan lain', 'memiliki pelatihan auditor internal'], ['food-safety', 'qa-testing', 'communication', 'leadership'], ['Bagaimana Anda membedakan ketidaksesuaian yang harus segera ditangani dari temuan administratif?', 'Apa bukti yang Anda periksa untuk memastikan tindakan koreksi berjalan efektif?'], 7_800_000, 'Jam kerja kantor mutu dengan kunjungan audit ke area produksi pada beberapa shift.'),
  ],
};

type ResolvedCompany = {
  company: FeaturedCompany;
  id: string;
  cityId: string;
  countryId: string;
  industryId: string;
  categoryId: string;
};
type PlannedJob = {
  company: ResolvedCompany;
  index: number;
  family: Family;
  title: string;
  level: (typeof LEVELS)[number];
  years: number;
  salaryMin: number;
  salaryMax: number;
  description: string;
  fingerprint: string;
  contentHash: string;
  skills: Array<{ id: string; name: string; slug: string }>;
  id: string;
};

function rootPath() { return path.resolve(__dirname, '../../../../'); }

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(rootPath(), '.env');
  if (!fs.existsSync(envPath)) throw new Error('DATABASE_URL is not set and the workspace .env file is missing');
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  if (!match) throw new Error('DATABASE_URL is missing from the workspace .env file');
  const value = match[1].trim().replace(/^("|')(.*)\1$/, '$2');
  process.env.DATABASE_URL = value;
  return value;
}

function assertDatabaseTarget(value: string, indonesiaVps: boolean) {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('Only PostgreSQL is supported');
  if (!indonesiaVps) {
    if (url.hostname !== '127.0.0.1' || url.port !== '5434' || database !== 'job_talentio') {
      throw new Error('Local-only guard rejected the database target; expected 127.0.0.1:5434/job_talentio');
    }
    return `${url.hostname}:${url.port}/${database}`;
  }
  if (process.env.HOSPITALITY_SEED_TARGET !== 'indonesia-vps' || process.cwd() !== '/app/apps/api' || !fs.existsSync('/.dockerenv')) {
    throw new Error('VPS guard rejected the execution context; run explicitly inside the Talentio API container on the VPS');
  }
  if (url.hostname !== 'host.docker.internal' || url.port !== '5432' || database !== 'talentio') {
    throw new Error('VPS guard rejected the database target; expected host.docker.internal:5432/talentio');
  }
  return `${url.hostname}:${url.port}/${database}`;
}

function localJobId(companySlug: string, index: number) {
  return `${SEED_VERSION}-job-${companySlug}-${String(index + 1).padStart(2, '0')}`;
}

function salaryFor(base: number, tier: number): [number, number] {
  const offsets: [number, number][] = [[0, 1_800_000], [2_000_000, 4_500_000], [4_500_000, 8_000_000]];
  return [base + offsets[tier][0], base + offsets[tier][1]];
}

function descriptionFor(job: {
  company: ResolvedCompany;
  family: Family;
  title: string;
  level: (typeof LEVELS)[number];
  years: number;
  salaryMin: number;
  salaryMax: number;
}) {
  const { company: resolved, family: roleFamily, level, title, salaryMin, salaryMax, years } = job;
  const company = resolved.company;
  const cityLabel = company.cityName.replace(/^Kota Administrasi /, '').replace(/^Kota /, '');
  const skillLabels = roleFamily.skillSlugs.map((slug) => slug.replace(/-/g, ' ')).join(', ');
  return [
    `Tentang perusahaan dan lokasi\n${company.description} ${company.workContext} Posisi ini ditempatkan di ${cityLabel}, dengan koordinasi langsung bersama tim terkait di lokasi.`,
    `Tujuan jabatan\nSebagai ${title}, Anda akan ${roleFamily.mission} Dalam tingkat ${level.code.toLowerCase()}, ruang lingkupnya meliputi ${level.scope}.`,
    `Tanggung jawab utama\n• ${roleFamily.duties.join('\n• ')}\n• ${level.extraDuty}.`,
    `Persyaratan wajib\n• ${roleFamily.requirements.join('\n• ')}\n• ${level.extraRequirement}.\n• Pengalaman kerja relevan minimal ${years} tahun.`,
    `Nilai tambah\n• ${roleFamily.preferred.join('\n• ')}.`,
    `Kompetensi kerja\nKompetensi yang digunakan dalam proses pencocokan: ${skillLabels}. Pengalaman praktis yang dapat dijelaskan dengan contoh kerja akan dipertimbangkan bersama keterampilan tersebut.`,
    `Kompensasi dan cara kerja\nPekerjaan penuh waktu, bekerja di lokasi dan mengikuti jadwal berikut: ${roleFamily.schedule} Kisaran gaji bruto Rp${salaryMin.toLocaleString('id-ID')}–Rp${salaryMax.toLocaleString('id-ID')} per bulan. Rincian akhir dan fasilitas disampaikan tertulis sebelum kandidat memutuskan menerima penawaran.`,
    `Tahapan seleksi\nSeleksi terdiri dari peninjauan lamaran, percakapan awal dengan HR, wawancara bersama calon atasan, dan pembahasan ruang lingkup pekerjaan. Perusahaan ini merupakan perusahaan contoh fiktif untuk demonstrasi Job Talentio; pelamar tidak dikenakan biaya pada tahap rekrutmen.`,
  ].join('\n\n');
}

function questionsFor(job: PlannedJob) {
  return job.family.questions.map((question, index) =>
    `${question} (Untuk posisi ${job.title}, jelaskan tindakan yang akan Anda ambil.)`,
  );
}

function validateContent() {
  const selected = TARGET_SLUGS.map((slug) => FEATURED_COMPANIES.find((company) => company.slug === slug));
  if (selected.some((company) => !company)) throw new Error('Selected company is missing from the reviewed company manifest');
  for (const company of selected as FeaturedCompany[]) {
    const families = FAMILIES[company.slug as (typeof TARGET_SLUGS)[number]];
    if (!families || families.length !== 20) throw new Error(`${company.slug} must contain exactly 20 job families`);
    if (!company.description.toLowerCase().includes('fiktif')) throw new Error(`${company.slug} must remain clearly marked as fictional`);
    if (company.industrySlug !== 'hospitality-restaurants') throw new Error(`${company.slug} is not in the reviewed hospitality industry`);
    const titles = families.flatMap((roleFamily) => roleFamily.titles);
    if (new Set(titles).size !== 60) throw new Error(`${company.slug} must have 60 distinct job titles`);
    if (families.some((roleFamily) => roleFamily.skillSlugs.length < 3)) throw new Error(`${company.slug} contains a family with fewer than three mapped skills`);
    if (families.some((roleFamily) => roleFamily.baseSalary < 6_000_000)) throw new Error(`${company.slug} contains an entry salary below Rp6,000,000`);
    if (families.some((roleFamily) => roleFamily.questions.length !== 2)) throw new Error(`${company.slug} must provide two screening questions per family`);
  }
  if (TARGET_SLUGS.length !== 3 || TARGET_SLUGS.reduce((sum, slug) => sum + FAMILIES[slug].length * 3, 0) !== 180) {
    throw new Error('The seed must describe exactly 180 new jobs across three companies');
  }
  return selected as FeaturedCompany[];
}

async function resolvePlan(db: PrismaClient) {
  const companies = validateContent();
  const resolvedCompanies: ResolvedCompany[] = [];
  for (const company of companies) {
    const cityRows = await db.city.findMany({
      where: {
        archivedAt: null,
        OR: [{ name: company.cityName }, { nameId: company.cityName }],
        province: { archivedAt: null, country: { iso2: 'ID', isActive: true, archivedAt: null } },
      },
      include: { province: { select: { countryId: true, country: { select: { id: true, iso2: true } } } } },
    });
    const cityMatches = cityRows.filter((row) => row.name.trim() === company.cityName || row.nameId?.trim() === company.cityName);
    if (cityMatches.length !== 1 || cityMatches[0].province.country.iso2 !== 'ID') {
      throw new Error(`Expected exactly one active Indonesian city catalog match for ${company.cityName}; found ${cityMatches.length}`);
    }
    const industry = await db.industry.findUnique({ where: { slug: company.industrySlug }, select: { id: true, archivedAt: true } });
    if (!industry || industry.archivedAt) throw new Error(`Active industry catalog entry is missing: ${company.industrySlug}`);
    const category = await db.jobCategory.findUnique({ where: { slug: 'hospitality' }, select: { id: true, archivedAt: true } });
    if (!category || category.archivedAt) throw new Error('Active hospitality job category is missing');
    resolvedCompanies.push({
      company,
      id: `${COMPANY_ID_PREFIX}${company.slug}`,
      cityId: cityMatches[0].id,
      countryId: cityMatches[0].province.countryId,
      industryId: industry.id,
      categoryId: category.id,
    });
  }

  const allSkillSlugs = [...new Set(companies.flatMap((company) => FAMILIES[company.slug as (typeof TARGET_SLUGS)[number]].flatMap((roleFamily) => roleFamily.skillSlugs)))];
  const skillRows = await db.skill.findMany({ where: { slug: { in: allSkillSlugs }, archivedAt: null }, select: { id: true, name: true, slug: true } });
  const skillsBySlug = new Map(skillRows.map((skill) => [skill.slug, skill]));
  const missingSkills = allSkillSlugs.filter((slug) => !skillsBySlug.has(slug));
  if (missingSkills.length) throw new Error(`Required active skill catalog entries are missing: ${missingSkills.join(', ')}`);

  const jobs: PlannedJob[] = [];
  for (const resolved of resolvedCompanies) {
    const families = FAMILIES[resolved.company.slug as (typeof TARGET_SLUGS)[number]];
    for (let familyIndex = 0; familyIndex < families.length; familyIndex += 1) {
      const roleFamily = families[familyIndex];
      for (let tier = 0; tier < 3; tier += 1) {
        const level = LEVELS[tier];
        const title = roleFamily.titles[tier];
        const [salaryMin, salaryMax] = salaryFor(roleFamily.baseSalary, tier);
        const baseJob = {
          company: resolved,
          index: familyIndex * 3 + tier,
          family: roleFamily,
          title,
          level,
          years: YEAR_EXPERIENCE[tier],
          salaryMin,
          salaryMax,
        };
        const description = descriptionFor(baseJob);
        if (description.trim().split(/\s+/u).length < 120) throw new Error(`Description is too short for ${resolved.company.slug}/${title}`);
        jobs.push({
          ...baseJob,
          id: localJobId(resolved.company.slug, familyIndex * 3 + tier),
          description,
          fingerprint: jobFingerprint({ title, workMode: 'ONSITE', cityId: resolved.cityId }),
          contentHash: contentHash(description),
          skills: roleFamily.skillSlugs.map((slug) => skillsBySlug.get(slug)!),
        });
      }
    }
  }
  if (jobs.length !== 180) throw new Error(`Expected 180 job rows; prepared ${jobs.length}`);
  if (new Set(jobs.map((job) => job.id)).size !== 180) throw new Error('Duplicate deterministic job IDs in seed content');
  if (new Set(jobs.map((job) => job.contentHash)).size !== 180) throw new Error('Job descriptions must be unique');
  return { companies: resolvedCompanies, jobs };
}

function assertSameCompany(existing: { id: string; slug: string; name: string; description: string | null; locale: string; cityId: string | null; industryId: string | null; size: string | null; website: string | null }, resolved: ResolvedCompany) {
  const company = resolved.company;
  if (existing.id !== resolved.id || existing.slug !== company.slug || existing.name !== company.name ||
      existing.description !== company.description || existing.locale !== 'id' || existing.cityId !== resolved.cityId ||
      existing.industryId !== resolved.industryId || existing.size !== company.size || existing.website !== company.website) {
    throw new Error(`Existing company does not exactly match the reviewed local profile: ${company.slug}`);
  }
}

function assertSameJob(existing: any, expected: PlannedJob) {
  if (existing.id !== expected.id || existing.companyId !== expected.company.id || existing.title !== expected.title ||
      existing.description !== expected.description || existing.cityId !== expected.company.cityId ||
      existing.countryId !== expected.company.countryId || existing.categoryId !== expected.company.categoryId ||
      existing.employmentType !== 'FULL_TIME' || existing.workMode !== 'ONSITE' ||
      existing.salaryMin !== expected.salaryMin || existing.salaryMax !== expected.salaryMax ||
      existing.salaryPeriod !== 'MONTHLY' || existing.currency !== 'IDR' ||
      existing.experienceYearsMin !== expected.years || existing.experienceLevel !== expected.level.code ||
      existing.locale !== 'id' || existing.isAnonymous !== false || existing.status !== 'PUBLISHED' ||
      existing.fingerprint !== expected.fingerprint || existing.contentHash !== expected.contentHash) {
    throw new Error(`Existing deterministic job differs from this seed and will not be overwritten: ${expected.id}`);
  }
  const actualSkills = existing.jobSkills.map((row: { skillId: string }) => row.skillId).sort();
  const expectedSkills = expected.skills.map((skill) => skill.id).sort();
  if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills)) throw new Error(`Existing skill associations differ: ${expected.id}`);
  const actualQuestions = existing.questions.sort((a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder);
  const expectedQuestions = questionsFor(expected);
  if (actualQuestions.length !== 2 || actualQuestions.some((question: { question: string }, index: number) => question.question !== expectedQuestions[index])) {
    throw new Error(`Existing screening questions differ: ${expected.id}`);
  }
  if (actualQuestions.some((question: { versions?: Array<unknown> }) => !question.versions?.length)) {
    throw new Error(`Existing screening question versions are incomplete: ${expected.id}`);
  }
}

async function inspectPlan(db: PrismaClient, plan: Awaited<ReturnType<typeof resolvePlan>>) {
  let companiesToCreate = 0;
  let jobsToCreate = 0;
  let jobsAlreadySeeded = 0;
  for (const resolved of plan.companies) {
    const byId = await db.company.findUnique({ where: { id: resolved.id }, select: { id: true, slug: true, name: true, description: true, locale: true, cityId: true, industryId: true, size: true, website: true } });
    const bySlug = await db.company.findUnique({ where: { slug: resolved.company.slug }, select: { id: true, slug: true, name: true, description: true, locale: true, cityId: true, industryId: true, size: true, website: true } });
    if (bySlug && !byId) throw new Error(`Company slug belongs to a different local row; refusing to attach jobs: ${resolved.company.slug}`);
    if (byId) assertSameCompany(byId, resolved);
    else companiesToCreate += 1;
  }
  for (const job of plan.jobs) {
    const existing = await db.jobPost.findUnique({
      where: { id: job.id },
      include: { jobSkills: { select: { skillId: true } }, questions: { where: { archivedAt: null }, include: { versions: { select: { id: true } } }, orderBy: { sortOrder: 'asc' } } },
    });
    if (existing) {
      assertSameJob(existing, job);
      jobsAlreadySeeded += 1;
      continue;
    }
    const collision = await db.jobPost.findFirst({
      where: { companyId: job.company.id, title: job.title, status: { in: ['DRAFT', 'PUBLISHED', 'PAUSED'] } },
      select: { id: true },
    });
    if (collision) throw new Error(`Active title collision in ${job.company.company.slug}: ${job.title}`);
    jobsToCreate += 1;
  }
  return { companiesToCreate, jobsToCreate, jobsAlreadySeeded };
}

async function applyPlan(db: PrismaClient, plan: Awaited<ReturnType<typeof resolvePlan>>) {
  const logoDirectory = path.join(rootPath(), 'apps', 'web', 'public', 'images', 'featured-companies');
  let companiesCreated = 0;
  let jobsCreated = 0;
  await db.$transaction(async (tx) => {
    const occupations=new EmployeeOccupationIndex(await tx.jobTitle.findMany({include:intentRoleInclude}));
    const missing=plan.jobs.filter(job=>!occupations.resolve(job.title));
    if(missing.length)throw new Error('Occupation catalog repair is required before seeding: '+missing.map(job=>job.title).join(', '));
    for (const resolved of plan.companies) {
      const existing = await tx.company.findUnique({ where: { id: resolved.id }, select: { id: true, slug: true, name: true, description: true, locale: true, cityId: true, industryId: true, size: true, website: true } });
      if (existing) {
        assertSameCompany(existing, resolved);
        continue;
      }
      const logoPath = path.join(logoDirectory, `${resolved.company.slug}.svg`);
      await tx.company.create({
        data: {
          id: resolved.id,
          slug: resolved.company.slug,
          name: resolved.company.name,
          description: resolved.company.description,
          locale: 'id',
          website: resolved.company.website,
          cityId: resolved.cityId,
          industryId: resolved.industryId,
          size: resolved.company.size,
          logoUrl: fs.existsSync(logoPath) ? `/images/featured-companies/${resolved.company.slug}.svg` : null,
          isVerified: false,
        },
      });
      companiesCreated += 1;
    }
    for (const job of plan.jobs) {
      if (await tx.jobPost.findUnique({ where: { id: job.id }, select: { id: true } })) continue;
      await tx.jobPost.create({
        data: {
          id: job.id,
          companyId: job.company.id,
          title: job.title,
          jobTitleId: occupations.resolve(job.title)!,
          description: job.description,
          cityId: job.company.cityId,
          countryId: job.company.countryId,
          categoryId: job.company.categoryId,
          employmentType: 'FULL_TIME',
          workMode: 'ONSITE',
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryPeriod: 'MONTHLY',
          currency: 'IDR',
          experienceYearsMin: job.years,
          experienceLevel: job.level.code,
          isAnonymous: false,
          locale: 'id',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          fingerprint: job.fingerprint,
          contentHash: job.contentHash,
          jobSkills: { create: job.skills.map((skill) => ({ skillId: skill.id })) },
        },
      });
      const questionTexts = questionsFor(job);
      for (let questionIndex = 0; questionIndex < questionTexts.length; questionIndex += 1) {
        const question = await tx.jobQuestion.create({
          data: {
            id: `${job.id}-question-${questionIndex + 1}`,
            jobPostId: job.id,
            question: questionTexts[questionIndex],
            type: 'TEXT',
            isRequired: true,
            sortOrder: questionIndex + 1,
            revision: 1,
          },
        });
        await tx.jobQuestionVersion.create({
          data: {
            id: `${job.id}-question-version-${questionIndex + 1}`,
            questionId: question.id,
            revision: 1,
            snapshot: JSON.parse(JSON.stringify(question)) as Prisma.InputJsonValue,
          },
        });
      }
      jobsCreated += 1;
    }
  }, { timeout: 120_000, maxWait: 20_000 });
  return { companiesCreated, jobsCreated };
}

async function refreshLocalRestaurantOperationsFamily(db: PrismaClient, plan: Awaited<ReturnType<typeof resolvePlan>>) {
  const expectedJobs = plan.jobs.filter((job) => job.company.company.slug === 'jelajah-rasa-indonesia' && job.family.slug === 'restaurant-operations');
  const previousTitles = ['Asisten Manajer Restoran', 'Manajer Giliran Operasi Restoran', 'Manajer Restoran'];
  if (expectedJobs.length !== 3) throw new Error('Expected exactly three Jelajah Rasa operations-family rows for the local title refresh');
  let updatedJobs = 0;
  await db.$transaction(async (tx) => {
    for (let index = 0; index < expectedJobs.length; index += 1) {
      const job = expectedJobs[index];
      const existing = await tx.jobPost.findUnique({
        where: { id: job.id },
        include: {
          jobSkills: { select: { skillId: true } },
          questions: { where: { archivedAt: null }, include: { versions: { select: { id: true } } }, orderBy: { sortOrder: 'asc' } },
          _count: { select: { applications: true, savedBy: true, views: true } },
        },
      });
      if (!existing) throw new Error(`Local title refresh cannot find its seed row: ${job.id}`);
      if (existing.title === job.title) {
        assertSameJob(existing, job);
        continue;
      }
      if (existing.title !== previousTitles[index] || existing.companyId !== job.company.id ||
          existing.cityId !== job.company.cityId || existing.countryId !== job.company.countryId ||
          existing.categoryId !== job.company.categoryId || existing.currency !== 'IDR' ||
          existing.status !== 'PUBLISHED' || existing.locale !== 'id' ||
          !existing.contentHash || !existing.fingerprint || existing._count.applications || existing._count.savedBy || existing._count.views ||
          existing.questions.length !== 2 || existing.questions.some((question) => question.versions.length !== 1)) {
        throw new Error(`Local title refresh found a row that is not the untouched previous seed version: ${job.id}`);
      }
      await tx.jobPost.update({
        where: { id: job.id },
        data: { title: job.title, description: job.description, fingerprint: job.fingerprint, contentHash: job.contentHash },
      });
      await tx.jobPostSkill.deleteMany({ where: { jobPostId: job.id } });
      await tx.jobPostSkill.createMany({ data: job.skills.map((skill) => ({ jobPostId: job.id, skillId: skill.id })) });
      const questions = questionsFor(job);
      for (let questionIndex = 0; questionIndex < existing.questions.length; questionIndex += 1) {
        const updatedQuestion = await tx.jobQuestion.update({
          where: { id: existing.questions[questionIndex].id },
          data: { question: questions[questionIndex], revision: { increment: 1 } },
        });
        await tx.jobQuestionVersion.create({
          data: {
            questionId: updatedQuestion.id,
            revision: updatedQuestion.revision,
            snapshot: JSON.parse(JSON.stringify(updatedQuestion)) as Prisma.InputJsonValue,
          },
        });
      }
      updatedJobs += 1;
    }
  }, { timeout: 30_000, maxWait: 10_000 });
  return { updatedJobs };
}

async function verifyPlan(db: PrismaClient, plan: Awaited<ReturnType<typeof resolvePlan>>) {
  const byCompany = [] as Array<{ slug: string; name: string; seededJobs: number; published: number; categoryMatches: number; salaryIdr: number }>;
  for (const resolved of plan.companies) {
    const expectedJobs = plan.jobs.filter((job) => job.company.id === resolved.id);
    const rows = await db.jobPost.findMany({
      where: { id: { in: expectedJobs.map((job) => job.id) } },
      select: { id: true, companyId: true, title: true, description: true, cityId: true, countryId: true, categoryId: true, currency: true, salaryMin: true, salaryMax: true, status: true, experienceLevel: true, experienceYearsMin: true, isAnonymous: true, locale: true, fingerprint: true, contentHash: true, employmentType: true, workMode: true, salaryPeriod: true, jobSkills: { select: { skillId: true } }, questions: { where: { archivedAt: null }, include: { versions: { select: { id: true } } }, orderBy: { sortOrder: 'asc' } } },
    });
    if (rows.length !== 60) throw new Error(`Verification failed for ${resolved.company.slug}: expected 60 seeded posts, found ${rows.length}`);
    for (const row of rows) {
      const expected = expectedJobs.find((job) => job.id === row.id)!;
      assertSameJob(row, expected);
      if (row.status !== 'PUBLISHED' || row.categoryId !== resolved.categoryId || row.currency !== 'IDR') {
        throw new Error(`Published/category/currency verification failed for ${row.id}`);
      }
    }
    byCompany.push({ slug: resolved.company.slug, name: resolved.company.name, seededJobs: rows.length, published: rows.filter((row) => row.status === 'PUBLISHED').length, categoryMatches: rows.filter((row) => row.categoryId === resolved.categoryId).length, salaryIdr: rows.filter((row) => row.currency === 'IDR').length });
  }
  if (byCompany.reduce((sum, row) => sum + row.seededJobs, 0) !== 180) throw new Error('Verification failed: total seeded job count is not 180');
  return byCompany;
}

async function main() {
  const mode = process.argv.slice(2);
  const supportedModes = ['--plan-local', '--apply-local', '--verify-local', '--refresh-local-operations-v1', '--plan-indonesia-vps', '--apply-indonesia-vps', '--verify-indonesia-vps'];
  if (mode.length !== 1 || !supportedModes.includes(mode[0])) {
    throw new Error(`Choose exactly one mode: ${supportedModes.join(', ')}`);
  }
  const indonesiaVps = mode[0].endsWith('-indonesia-vps');
  const target = assertDatabaseTarget(loadDatabaseUrl(), indonesiaVps);
  const db = new PrismaClient();
  try {
    await db.$connect();
    const databaseRows = await db.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS "database"`;
    const expectedDatabase = indonesiaVps ? 'talentio' : 'job_talentio';
    if (databaseRows[0]?.database !== expectedDatabase) throw new Error(`Connected database mismatch; expected ${expectedDatabase}`);
    const plan = await resolvePlan(db);
    if (mode[0] === '--refresh-local-operations-v1') {
      const refreshed = await refreshLocalRestaurantOperationsFamily(db, plan);
      const byCompany = await verifyPlan(db, plan);
      console.log(JSON.stringify({ target, mode: mode[0], ...refreshed, totalVerified: byCompany.reduce((sum, row) => sum + row.seededJobs, 0) }, null, 2));
      return;
    }
    if (mode[0] === '--verify-local' || mode[0] === '--verify-indonesia-vps') {
      const byCompany = await verifyPlan(db, plan);
      console.log(JSON.stringify({ target, mode: mode[0], totalNewJobs: 180, companies: byCompany }, null, 2));
      return;
    }
    const inspected = await inspectPlan(db, plan);
    if (mode[0] === '--plan-local' || mode[0] === '--plan-indonesia-vps') {
      console.log(JSON.stringify({ target, mode: mode[0], companies: 3, totalNewJobs: 180, ...inspected }, null, 2));
      return;
    }
    assert.equal(mode[0], indonesiaVps ? '--apply-indonesia-vps' : '--apply-local');
    const applied = await applyPlan(db, plan);
    const byCompany = await verifyPlan(db, plan);
    console.log(JSON.stringify({ target, mode: mode[0], ...applied, alreadyPresent: inspected.jobsAlreadySeeded, totalVerified: byCompany.reduce((sum, row) => sum + row.seededJobs, 0), companies: byCompany }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
