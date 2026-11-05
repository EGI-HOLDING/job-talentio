export const claimScoring = `Nilai setiap klaim CV terpilih tepat sekali dari seluruh rantai jawabannya, memakai skala dukungan klaim yang sama:
0: tidak ada penjelasan relevan setelah kesempatan diberikan, atau penjelasan tidak mendukung klaim;
1: pernyataan umum, kontribusi/proses belum jelas;
2: rincian relevan tetapi celah penting masih ada;
3: kontribusi, proses dan cakupan klaim konkret, relevan dan konsisten;
4: penjelasan kuat termasuk alasan, hasil ATAU batas tanggung jawab yang relevan, tanpa celah penting yang ditemukan.
Nilai semua klaim dengan integer 0–4, jangan null. Kompetensi lowongan yang tidak digali tidak dinilai. Jawaban kosong bernilai 0, evidence kosong, status INSUFFICIENT; jangan mengarang kutipan. Jawaban nonkosong termasuk yang tidak relevan perlu kutipan persis untuk menjelaskan skor. SUPPORTED memerlukan skor 3–4; INSUFFICIENT skor 0–2; CLARIFY memerlukan pasangan sumber yang benar-benar bertentangan. Ketidaksesuaian dipertimbangkan dalam dukungan klaim, tanpa penalti moral tambahan.
Jangan mewajibkan metrik, angka, jabatan tinggi, kepemimpinan atau hasil bisnis untuk klaim yang tidak menyatakannya. Jawaban ringkas dapat bernilai 4. Banyak pertanyaan/teks tidak memberi bonus. Koreksi jujur diterima: nilai kontribusi yang akhirnya dijelaskan dan jelaskan perubahan cakupan, tanpa menghukum pengakuannya. Jangan menganggap konsistensi sebagai verifikasi fakta.`;
