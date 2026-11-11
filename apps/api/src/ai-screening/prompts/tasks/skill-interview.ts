import type { JsonSchema } from '../../screening.schemas';

export const skillCandidate = `Pilih maksimal empat klaim KEAHLIAN tertulis yang relevan dengan tugas lowongan. Isi skill dengan nama yang persis tercantum di quote CV; pilih criterionId yang mendasarinya. CORE untuk kaitan langsung dengan tugas utama, SUPPORTING untuk tugas pendukung. Urutkan dari prioritas tertinggi dan pilih satu klaim per keahlian, termasuk sinonim. GENERAL berarti CV menyebut keahlian tanpa menyatakan penggunaannya pada pengalaman tertentu. CONTEXTUAL berarti CV menyebut penggunaannya pada proyek atau peran tertentu; pertahankan konteks di statement dan dalam pertanyaan. Pertahankan batas belajar, membantu, bekerja dalam tim, atau memimpin. Jangan simpulkan keterampilan yang tidak tertulis. Gunakan quote persis dan lineStart/lineEnd. Pertanyaan awal mengajak kandidat memberi satu contoh tindakan pribadinya, tanpa menebak jawaban atau mengharuskan pengalaman formal. Sisakan ruang untuk pembuka server: maksimal 30 kata dan 260 karakter per pertanyaan. Jangan mulai dengan salam, emoji, nah, eh atau tadi. Jika tidak ada klaim relevan, claims kosong dan alternativeCriterionId adalah tugas inti pertama yang cocok untuk menanyakan pengalaman alternatif. Jika ada klaim, alternativeCriterionId null.`;

export const skillTurn = `Baca hanya giliran klaim yang diberikan. Putuskan EXAMPLE jika kandidat menjelaskan penggunaan skill dan tindakan pribadinya dalam cakupan klaim. NEEDS_DETAIL jika satu detail penting belum jelas; OFF_TOPIC jika jawaban tidak menjelaskan klaim yang ditanya. DISCREPANCY hanya bila jawaban secara eksplisit bertentangan dengan cakupan klaim tertulis, bukan karena singkat, berbeda gaya, kurang lancar, atau tidak menyebut nama perusahaan. Untuk klaim umum, contoh magang, bantu dosen, proyek pribadi atau belajar sah. Jangan menilai kejujuran, memberi nilai atau keputusan kerja. Sertakan answerQuote persis dari jawaban terakhir. Jika perlu memperjelas, question adalah satu pertanyaan netral gaya gue-lu yang menanyakan detail berbeda atau mengarahkan balik. Untuk DISCREPANCY, klarifikasi maksud kandidat tanpa menyudutkan. Untuk EXAMPLE, question null. Gunakan candaan hanya jika sesuai, dan tanpa candaan jika tonePreference direct. Jangan memberi contoh jawaban.`;

export const SKILL_TURN_SCHEMA: JsonSchema = {
    type: 'object', additionalProperties: false, required: ['outcome', 'answerQuote', 'question'],
    properties: {
        outcome: { type: 'string', enum: ['EXAMPLE', 'NEEDS_DETAIL', 'OFF_TOPIC', 'DISCREPANCY'] },
        answerQuote: { type: 'string', maxLength: 180 },
        question: { anyOf: [{type:'string', maxLength:280}, {type:'null'}] },
    },
};

export const timedCandidate = 'Untuk setiap klaim, bukti minimum sudah mencakup tugas dan tindakan pribadi. Isi extraEvidence hanya untuk hal eksplisit di quote CV: CONTEXT jika CV mengklaim penggunaan pada pengalaman tertentu, RESULT jika ada hasil tertentu, ROLE_BOUNDARY jika CV menyebut batas kontribusi seperti membantu atau memimpin. Kutip bagian quote CV secara literal. Gunakan array kosong jika tidak ada.';
export const timedTurn = 'Baca jawaban terakhir untuk klaim aktif dan klaim lain yang masih menunggu. Isi evidence dengan topik yang benar-benar didukung jawaban. Tiap entri memuat topicId, satu kutipan literal jawaban terakhir, serta fields yang dibuktikan kutipan itu. TASK berarti pekerjaan yang dilakukan, ACTION tindakan kandidat sendiri dengan skill yang dimaksud. CONTEXT, RESULT, dan ROLE_BOUNDARY hanya bila terbukti. Penyebutan nama skill saja tidak cukup. Untuk klaim aktif, EXAMPLE hanya bila bukti minimum sudah lengkap dengan bukti terdahulu. Jika belum lengkap, tanyakan satu celah paling penting. Untuk pembacaan jawaban yang sedang berlangsung, utamakan bukti yang sudah konkret dan jangan menyimpulkan bahwa kandidat gagal atau bertentangan.';
export const TIMED_TURN_SCHEMA: JsonSchema = {
    ...SKILL_TURN_SCHEMA,
    required: [...SKILL_TURN_SCHEMA.required!, 'evidence'],
    properties: {
        ...SKILL_TURN_SCHEMA.properties,
        evidence: {
            type: 'array', maxItems: 4,
            items: {
                type: 'object', additionalProperties: false, required: ['topicId', 'quote', 'fields'],
                properties: {
                    topicId: {type: 'string'},
                    quote: {type: 'string', maxLength: 450},
                    fields: {type: 'array', maxItems: 5, items: {type: 'string', enum: ['TASK', 'ACTION', 'CONTEXT', 'RESULT', 'ROLE_BOUNDARY']}},
                },
            },
        },
    },
};
