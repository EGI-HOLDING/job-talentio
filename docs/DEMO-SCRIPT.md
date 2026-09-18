# Skrip demo Job Talentio (staging Uzbekistan)

Alur 10 menit untuk demo terpandu, lalu checklist agar klien bisa mencoba sendiri dari HP. Semua di `https://staging.jobtalent.io` (UI default Oʻzbek). Akun seed: [JOBTALENTIO-DUMMY.md](../JOBTALENTIO-DUMMY.md).

## H-1: persiapan

1. Reset data demo agar pipeline penuh dan lowongan hero ada di atas:
   `railway ssh --service api-stage-job-talentio -- sh -c "ALLOW_DEMO_RESET=1 node dist/scripts/demo-reset.js"`
2. Siapkan dua perangkat: HP (pencari kerja, browser Chrome/Safari, Telegram terpasang) dan laptop (recruiter + admin).
3. Siapkan satu CV PDF contoh pencari kerja IT support (pengalaman "IT Infrastructure & Support Specialist", 3+ tahun, Windows Server / AD / jaringan). Lowongan hero pertama ditulis agar skor match-nya tinggi.
4. Login sekali di HP sebagai employee `madina.karimova@jobtalent.io` dan tautkan Telegram (Settings > Security > Telegram) supaya alert dan relay chat terlihat saat demo. Alternatif: daftar akun baru lewat tombol Telegram saat demo (lebih meyakinkan, tetapi bergantung sinyal).
5. Login di laptop sebagai recruiter `jasur.tursunov@apexsoft.uz` (Apex Soft Tashkent, pemilik dua lowongan hero) dan admin `sarvar.adminov@jobtalentio.uz`.

## 10 menit sebelum mulai: pre-flight

- `GET https://api-staging.jobtalent.io/api/health` -> 200; `https://staging.jobtalent.io/uz` -> 200.
- Halaman `/uz/jobs`: lowongan hero (IT Infrastructure & Support Specialist, Frontend Developer, Sales Manager, Accountant, Hotel Front Office Manager, English Teacher) berada di atas dengan badge hot.
- Upload CV uji sebagai Madina, tunggu parse selesai (LLM, biasanya < 30 detik), buka review, batalkan tanpa impor.
- Kirim satu pesan chat dari recruiter ke Madina; pesan harus sampai ke Telegram-nya.
- Buka lowongan berbahasa Rusia dengan UI Oʻzbek: badge bahasa tampil dan tombol terjemah bekerja.
- Kirim email uji (misalnya reset password ke mailbox sungguhan) untuk memastikan Resend terkirim.

Jika salah satu gagal, lihat bagian Troubleshooting sebelum demo.

## Alur 10 menit

| Waktu | Layar | Yang ditunjukkan | Kalimat kunci |
|-------|-------|------------------|---------------|
| 0:00 | HP, beranda `/uz` | Pencarian, perusahaan VIP, lowongan hot, chip kategori/kota, tiga bahasa | "Default Oʻzbek, satu ketuk ke Rusia atau Inggris. Semua konten, bukan hanya menu." |
| 1:00 | HP, masuk | Tombol Telegram / Google, atau login Madina | "Kandidat di Uzbekistan hidup di Telegram; masuk tanpa email pun bisa." |
| 1:45 | HP, dashboard employee | Upload CV PDF -> parse -> modal review -> impor selektif | "CV dibaca AI, kandidat tetap memutuskan apa yang diimpor. Tidak ada form panjang." |
| 3:00 | HP, tab Rekomendasi / beranda | Lowongan cocok dengan skor dan rincian (skill, pengalaman, lokasi) | "Skor bukan kotak hitam: kandidat tahu kenapa cocok." |
| 3:45 | HP, detail lowongan hero IT | Deskripsi Oʻzbek berbutir, gaji UZS, screening question | "Recruiter menyaring dari awal, bukan setelah 200 lamaran." |
| 4:30 | HP, apply | Isi jawaban screening + cover letter -> sukses -> buat job alert (Telegram) | "Kandidat mendapat lowongan baru lewat Telegram tanpa membuka situs." |
| 5:15 | Laptop, recruiter Jasur, pipeline | Lamaran baru Madina, tombol Show answers, cover letter, skor | "Jawaban screening langsung di kartu kandidat." |
| 6:00 | Laptop, pipeline | Pindah ke Interview, jadwalkan, kirim chat | HP Madina bergetar: pesan masuk di Telegram. "Chat web dan Telegram satu percakapan." |
| 7:00 | Laptop, tab Bulk | Template pesan, pilih tahap, kirim ke app + email + Telegram | "Pesan massal ke satu tahap pipeline, opt-out dihormati." |
| 7:45 | Laptop, edit lowongan | Versi bahasa: terjemah otomatis ke Rusia, koreksi manual | "Satu lowongan, tiga bahasa, tanpa mengetik tiga kali." |
| 8:30 | Laptop, `/talent` | Filter kandidat (skill, kota, bahasa, match ke lowongan) | "Basis kandidat aktif, bukan arsip resume." |
| 9:15 | Laptop, admin | Moderasi laporan, antrean terjemahan katalog, feature flag | "Operasional siap: moderasi, audit, katalog uz/ru." |
| 9:45 | Penutup | Roadmap: login nomor telepon, kanal Telegram, PWA, pembayaran Payme/Click | Jawab pertanyaan. |

Jika waktu kurang, lewati baris 7:00 dan 9:15.

## Klien mencoba sendiri: checklist yang diberikan

Berikan daftar ini (uz/ru bila perlu) beserta akun seed dan minta mereka mencoba dari HP sendiri:

1. Buka `staging.jobtalent.io`, ganti bahasa, cari lowongan dengan kata kunci Oʻzbek dan Rusia.
2. Daftar sebagai pencari kerja dengan Telegram atau Google. Isi profil, upload CV sendiri, impor hasil parse.
3. Lamar satu lowongan hero, jawab screening. Buat job alert ke Telegram.
4. Masuk sebagai recruiter Jasur di laptop: lihat lamaran tadi, pindahkan tahap, chat, jadwalkan interview.
5. Buat lowongan baru dengan screening question sendiri, publikasikan, cari dari HP.
6. Tambah versi bahasa lowongan, cek tampilannya di HP dengan UI bahasa lain.
7. Unduh resume PDF dari resume builder.

Batasan yang perlu disebut sebelum mereka mencoba: pembayaran berjalan dalam mode demo (checkout tidak menagih), login nomor telepon dan kanal Telegram publik masuk fase berikutnya, aplikasi native belum ada (situs responsif).

## Go / no-go sebelum demo

- Semua langkah pre-flight lulus dari HP dan laptop.
- Tidak ada teks Inggris bocor pada UI Oʻzbek/Rusia di layar yang dipakai skrip (`pnpm check:i18n-ui` hijau di CI bukan pengganti melihat layar).
- CV parse memakai LLM (`CV_PARSE_PROVIDER=llm`) dan terjemahan otomatis aktif (`TRANSLATION_PROVIDER=openai`).
- Alert dan chat sampai ke Telegram; email sampai ke mailbox sungguhan.
- Railway: `website-job-talentio`, `api-stage-job-talentio`, `admin-stage-job-talentio` semuanya SUCCESS pada commit `develop` terakhir.

## Troubleshooting cepat

| Gejala | Penyebab umum | Tindakan |
|--------|---------------|----------|
| Parse CV tetap "pending" | Worker BullMQ / Redis, atau OpenAI lambat | Tunggu 60 detik, refresh; cek log api `railway logs --service api-stage-job-talentio`; fallback parser lokal tetap mengisi data dasar |
| Telegram tidak menerima pesan | Akun belum ditautkan atau webhook belum terdaftar | Settings > Security > tautkan ulang; `GET /api/telegram/webhook` harus `{ok:true}`; cek `TELEGRAM_WEBHOOK_SECRET` |
| Tombol terjemah tidak muncul / "budget exceeded" | `TRANSLATION_PROVIDER=none` atau kuota bulanan habis | Set provider `openai`, naikkan `TRANSLATION_MONTHLY_CHAR_BUDGET`, redeploy api |
| Pencarian tidak menemukan lowongan baru | Indeks Meilisearch kosong setelah reset | Lakukan satu pencarian; API mengindeks ulang otomatis, atau redeploy api |
| Pipeline recruiter kosong | Reset belum dijalankan atau memakai recruiter lain | Jalankan demo-reset; gunakan Jasur (Apex Soft Tashkent) |
| Email tidak sampai | Domain Resend belum terverifikasi atau mailbox dummy | Pakai mailbox sungguhan; alamat seed `@jobtalent.io` sengaja tidak dikirimi email |
