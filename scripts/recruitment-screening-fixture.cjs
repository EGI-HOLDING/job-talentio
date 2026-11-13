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
    const line = input.cvSegments.find(line => line.text.includes('Mengembangkan API Node.js'));
    assert.ok(line);
    return { claims: [{ sourceRef: line.id, criterionId: 'criterion-0', skillText: 'API', relevance: 'CORE' }] };
  }
  if (task === 'follow-up') {
    const answer = input.chain.at(-1).answer;
    const example = answer.startsWith('Saya sendiri membuat');
    const quote = example ? 'Saya sendiri membuat dua endpoint inventaris menggunakan Node.js.' : 'Saya membantu bagian API.';
    return { outcome: example ? 'EXAMPLE' : 'NEEDS_DETAIL', answerQuote: quote,
      question: example ? null : 'Bagian mana dari pengembangan API yang lu kerjakan sendiri?',
      evidence: example ? [{ topicId: input.topic.id, quote, fields: ['TASK', 'ACTION'] }] : [] };
  }
  assert.equal(task, 'evaluate');
  return {
    claims: Object.fromEntries(input.claims.map(claim => {
      const quote = input.evidenceCatalog.find(row => row.source === 'ANSWER' && row.text.includes('Saya sendiri membuat'));
      assert.ok(quote);
      return [claim.id, { level: 'CONCRETE', reason: 'Ada penjelasan kontribusi pribadi.',
        evidence: [{ quoteRef: quote.id, fields: ['TASK', 'ACTION'] }], discrepancyRef: null }];
    })),
  };
};
