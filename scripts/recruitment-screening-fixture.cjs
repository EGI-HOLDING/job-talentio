const assert = require('node:assert/strict');

module.exports = function screenFixture(task, input) {
  if (task === 'prepare') {
    const terms = ['API', 'Node.js', 'backend'];
    return { context: 'Layanan backend dan pengembangan API.', criteria: terms.map((term, index) => ({
      id: 'criterion-' + index, name: term, requirementRef: term,
      anchors: ['Belum ada contoh', 'Menyebut nama', 'Menjelaskan sebagian', 'Menjelaskan langkah kerja', 'Menjelaskan hasil terukur'],
    })) };
  }
  if (task === 'candidate') {
    const line = input.cvLines.find(line => line.text.includes('Mengembangkan API Node.js'));
    assert.ok(line);
    return { claims: [{ id: 'claim-1', criterionId: 'criterion-0', statement: line.text, quote: line.text, lineStart: line.line, lineEnd: line.line, question: 'Di proyek API Node.js yang tertulis di CV lu, bagian mana yang lu kerjakan sendiri?' }], limitations: [] };
  }
  if (task === 'follow-up') {
    return { stop: false, question: input.targetDepth === 1
      ? 'Waktu menangani endpoint inventaris yang lu sebut, bagaimana lu menentukan skenario pengujian untuk memastikan perubahan jumlah stok benar-benar tersimpan dan bisa dicek ulang tim QA?'
      : 'Ketika permintaan pembaruan stok yang sama masuk dua kali, langkah apa yang lu pakai supaya layanan tetap menyimpan satu transaksi dan gimana lu membuktikan hasilnya lewat pengujian?' };
  }
  assert.equal(task, 'evaluate');
  return {
    summary: 'Kandidat menjelaskan kontribusi pribadi pada pengembangan API.', strengths: ['Pengalaman API dijelaskan.'], gaps: [], interviewQuestions: [],
    claims: input.claims.map(claim => {
      const answer = input.answers.filter(row => row.claimId === claim.id).at(-1);
      const quote = input.evidenceCatalog.find(row => row.source === 'ANSWER' && row.ref === answer.id);
      assert.ok(quote);
      return { claimId: claim.id, judgement: { level: 'CONCRETE', detail: 'NONE', detailRef: null }, status: 'SUPPORTED', reason: 'Ada penjelasan kontribusi pribadi.', evidence: [{ questionId: answer.id, quoteRef: quote.id }], contradictions: [] };
    }),
  };
};
