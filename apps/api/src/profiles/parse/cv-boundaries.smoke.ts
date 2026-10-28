import assert from 'node:assert/strict';
import { parseCvText } from '../cv-parser';
import { careerDates } from '../career-dates';
import { extractCvText } from './cv-text-extract';
import { validateCvDocxArchive } from './cv-archive-limit';
import { normalizeSkillKey } from '../../common/skill-resolve';
import { createRequire } from 'node:module';
const PDFDocument = require('pdfkit');
const JSZip = createRequire(require.resolve('mammoth'))('jszip');

async function main() {
  const skills = [{ name: 'React', slug: 'react' }, { name: 'Python', slug: 'python' }];
  const ru = parseCvText('Иван Иванов\nРазработчик\nО себе:\nРаботаю с Python, но это не перечень навыков.\nОпыт работы\nFrontend Developer at National University\nJanuary 2020 - Present\nОбразование\nLocal College\nBachelor 2014 2018\nНавыки\nReact', skills);
  assert.deepEqual(ru.skillNames, ['React'], 'Russian skill section must not absorb summary text');
  assert.equal(ru.experiences[0]?.companyName, 'National University', 'University employers remain work experience inside an explicit work section');
  assert.equal(ru.educations[0]?.school, 'Local College');
  const id = parseCvText('Andi Pratama\nFrontend Developer\nPengalaman kerja\nFrontend Developer at Apex Soft\nAgustus 2020 sampai Desember 2021\nBackend Developer at Studio Digital\nMei 2022 - Saat ini\nKeahlian\nReact', skills);
  assert.equal(id.experiences[0]?.startDate, '2020-08-01');
  assert.equal(id.experiences[0]?.endDate, '2021-12-01');
  assert.equal(id.experiences[1]?.startDate, '2022-05-01');
  assert.equal(id.experiences[1]?.isCurrent, true);
  assert.throws(() => careerDates({ startDate: '2024-02-31' }, true));
  assert.throws(() => careerDates({ startDate: '2090-01-01' }, true));
  assert.throws(() => careerDates({ startDate: '2024-01-01', endDate: '2020-01-01' }, true));
  assert.equal(careerDates({ startDate: '2020-01-01', endDate: '2019-01-01', isCurrent: true }, true).endDate, null);
  const oversized = await new Promise<Buffer>(resolve => {
    const pdf = new PDFDocument({ autoFirstPage: false }); const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(chunks)));
    for (let page = 0; page < 21; page++) pdf.addPage().text('Readable CV content on every page. Frontend Developer React TypeScript.');
    pdf.end();
  });
  await assert.rejects(extractCvText({ buffer: oversized, filename: 'too-long.pdf', mimeType: 'application/pdf' }), /20-page/);
  const fragmented = await new Promise<Buffer>(resolve => {
    const pdf = new PDFDocument(); const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.fontSize(14).text('Frontend', 60, 60, { lineBreak: false });
    pdf.text('Developer', 130, 60.5, { lineBreak: false });
    pdf.text('at Apex Soft. React and TypeScript.', 60, 90); pdf.end();
  });
  const extracted = await extractCvText({ buffer: fragmented, filename: 'fragments.pdf', mimeType: 'application/pdf' });
  assert.match(extracted.text, /Frontend Developer/, 'PDF fragments need spaces and small baseline differences are not new lines');
  const bomb = new JSZip(); bomb.file('word/document.xml', 'x'.repeat(17 * 1024 * 1024));
  const compressed = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.throws(() => validateCvDocxArchive(compressed), /oversized/);
  // A forged central directory cannot evade the actual inflation bound.
  const forged = Buffer.from(compressed);
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(100, central + 24);
  assert.throws(() => validateCvDocxArchive(forged));
  assert.throws(() => validateCvDocxArchive(Buffer.from('not a zip')));
  assert.equal(normalizeSkillKey('Коммуникация'), 'коммуникация');
  assert.notEqual(normalizeSkillKey('Навык A'), normalizeSkillKey('Навык B'));
  const unknownLanguage = parseCvText('Jane Doe\nLanguages\nEnglish', [], [{ name: 'English', code: 'en' }]);
  assert.equal(unknownLanguage.languages[0]?.level, undefined, 'A language name alone must not invent CEFR proficiency');
  const meaningless = parseCvText('This is an ordinary document without any curriculum vitae information.\n' + 'Just another unrelated paragraph of miscellaneous text. '.repeat(5));
  assert.equal(meaningless.headline, undefined, 'An arbitrary line is not a professional headline');
  assert.equal(meaningless.summary, undefined, 'Arbitrary document text must not create a fabricated CV summary');
  for (const heading of ['Frontend Developer\nApex Soft', 'Apex Soft\nFrontend Developer', 'Frontend Developer at Apex Soft January 2024 - Present']) {
    const text = heading.includes('Present') ? heading : heading + '\nJanuary 2024 - Present';
    const layout = parseCvText('Jane Doe\nExperience\n' + text + '\nBuilt reliable web applications.\nSkills: React', skills);
    assert.equal(layout.experiences[0]?.title, 'Frontend Developer', heading);
    assert.equal(layout.experiences[0]?.companyName, 'Apex Soft', heading);
  }
  console.log('PASS: RU/ID boundaries and dates, chronology, PDF page limit/fragment spacing, Unicode skills, declared and forged DOCX inflation limits');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
