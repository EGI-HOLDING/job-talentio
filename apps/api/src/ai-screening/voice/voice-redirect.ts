const questionOpening = /\b(?:bagian mana|langkah apa|apa(?: yang)?|gimana|bagaimana|kenapa|kapan|berapa|siapa|ceritain|ceritakan|jelasin|jelaskan|sebutin|sebutkan|uraikan|bisa(?:kah)? (?:beri(?:kan)?|kasih)|how did you|which part|describe)\b/iu;
const scaffolding = new Set('aja anda bagian cara coba dan dari detail itu kamu ke lo lu mana nya soal tadi yang a about did of that the to you your'.split(' '));

function hasFocusedRequest(text: string) {
    return text.split(/(?<=[?!.])\s+/u).some(clause => {
        const opening = questionOpening.exec(clause);
        if (!opening || /(?:\.{3}|[…–—-])\s*$/u.test(clause)) return false;
        const words = clause.slice(opening.index + opening[0].length).match(/[\p{L}\p{N}+#]+/gu) ?? [];
        return words.some(word => (word.length >= 3 || /^[A-Z0-9+#]{2,}$/u.test(word)) && !scaffolding.has(word.toLowerCase()));
    });
}

export function isIncompleteQuestion(text: string) {
    return questionOpening.test(text) && !hasFocusedRequest(text);
}

export function isReadinessCheck(text: string) {
    return /(?:^|[.!?]\s+|,\s+)(?:(?:bisa|boleh) (?:kita )?(?:mulai|lanjut)|(?:kita )?mulai (?:ya|sekarang)|(?:lo|lu|kamu|anda) (?:(?:udah|sudah) )?siap(?: (?:mulai|untuk mulai))?|(?:(?:udah|sudah) )?siap(?: (?:mulai|untuk mulai))?)[.!?\s]*$/iu.test(text.trim());
}
