import PDFDocument from 'pdfkit';
import { candidateCvCriteria, type CandidateCvResult } from '@job-talentio/shared';
import { screeningReportFonts } from '../screening-report';

export function renderCandidateCvPdf({ name, job, date, score, result }: {
  name: string; job: string; date: Date; score: number | null; result: CandidateCvResult;
}): Promise<Buffer> {
  const language = result.assessmentLanguage ?? 'id';
  const en = language === 'en';
  const locale = en ? 'en-US' : 'id-ID';
  const title = en ? 'Taka CV report' : 'Laporan CV Taka';
  const fonts = screeningReportFonts();
  const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: title, Author: 'Talentio' } });
  const chunks: Buffer[] = [];
  const ready = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', fonts.regular).registerFont('Bold', fonts.bold);
  doc.image(fonts.logo, 44, 38, { fit: [126, 34] });
  doc.y = 90;
  doc.font('Bold').fillColor('#161132').fontSize(23).text(title).moveDown(.4);
  doc.fontSize(16).text(name);
  if (job) doc.font('Body').fontSize(11).text(job);
  doc.font('Body').fillColor('#655d7e').fontSize(10).text(date.toLocaleDateString(locale, { dateStyle: 'long' })).moveDown();
  if (score !== null) {
    doc.font('Bold').fillColor('#591cee').fontSize(25).text(`${score.toLocaleString(locale, { maximumFractionDigits: 1 })}%`);
    doc.fontSize(11).text(en ? 'CV match' : 'Kecocokan CV').moveDown();
  }
  if (result.narrative) {
    const pending = result.narrative.state === 'PENDING';
    doc.font('Body').fillColor('#655d7e').fontSize(10).text(en
      ? pending ? 'The report text is being prepared.' : 'The report text needs review.'
      : pending ? 'Penjelasan bahasa sedang disiapkan.' : 'Bahasa penjelasan perlu ditinjau.').moveDown();
  }
  if (result.summary) doc.font('Body').fillColor('#161132').fontSize(11).text(result.summary).moveDown();
  const criteria = candidateCvCriteria(result, language);
  if (criteria.length) doc.font('Bold').fillColor('#161132').fontSize(15).text(en ? 'Criteria scores' : 'Nilai per kriteria').moveDown(.4);
  for (const row of criteria) {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.font('Bold').fillColor('#161132').fontSize(12).text(`${row.name}  ·  ${row.level}/4`).moveDown(.25);
    doc.font('Body').fontSize(10).text(row.reason).moveDown(.35);
    for (const { quote, page } of row.evidence) {
      const source = en ? 'CV evidence' : 'Kutipan CV';
      const location = page ? ` · ${en ? 'Page' : 'Halaman'} ${page}` : '';
      doc.font('Bold').fillColor('#591cee').text(source + location);
      doc.font('Body').fillColor('#3d3557').text(quote, { indent: 12 }).moveDown(.4);
    }
    doc.moveDown(.6);
  }
  if (result.limitations?.length) {
    doc.font('Bold').fillColor('#161132').fontSize(12).text(en ? 'Review notes' : 'Perlu didalami').moveDown(.4);
    doc.font('Body').fontSize(10).list(result.limitations);
  }
  doc.end();
  return ready;
}
