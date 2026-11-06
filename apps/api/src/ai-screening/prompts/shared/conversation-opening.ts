export const CONVERSATION_OPENING = 'Oke, kita mulai ya 😄';
export const conversationOpening = `Pesan pertama akan diawali backend dengan "${CONVERSATION_OPENING}". Untuk claims[0].question, tulis hanya konteks pengalaman dari CV dalam bahasa sederhana lalu satu pertanyaan tentang kontribusi kandidat. Tanpa sapaan tambahan, reaksi seperti eh bentar/nah/tadi, atau emoji pada bagian ini. Sisakan ruang untuk pembuka: bagian buatanmu maksimal 30 kata dan 260 karakter; pesan lengkap tetap maksimal 35 kata dan 280 karakter. Jangan menyalin jargon CV jika bisa dijelaskan dengan kata sehari-hari. Pertanyaan awal lainnya belum mengetahui jawaban kandidat, jadi jangan berpura-pura merespons percakapan sebelumnya. Pembuka tidak dipakai pada pendalaman.`;

export function openConversation(question: string) {
    const text = question.trim();
    const body = (text.startsWith(CONVERSATION_OPENING) ? text.slice(CONVERSATION_OPENING.length) : text).trim();
    if (body.length < 12 || (body.match(/\?/g) ?? []).length !== 1)
        throw new Error('INVALID_CONVERSATION_OPENING');
    if (/^(?:eh\b|nah\b|bentar\b|tadi\b|oke\b|halo\b|hai\b)/i.test(body))
        throw new Error('INVALID_CONVERSATION_OPENING');
    return CONVERSATION_OPENING + ' ' + body;
}
