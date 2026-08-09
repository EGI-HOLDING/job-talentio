import PDFDocument from 'pdfkit';

export type PdfResumeDoc = {
  fullName: string;
  headline?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  summary?: string | null;
  templateKey: string;
  themeAccent?: string | null;
  skills: string[];
  experiences: Array<{
    title: string;
    companyName: string;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent?: boolean;
    description?: string | null;
    location?: string | null;
  }>;
  educations: Array<{
    school: string;
    degree?: string | null;
    field?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }>;
  languages: Array<{ name: string; level?: string | null }>;
  certifications: Array<{ name: string; issuer?: string | null }>;
};

function fmtDate(d?: string | null) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function dateRange(start?: string | null, end?: string | null, isCurrent?: boolean) {
  const a = fmtDate(start);
  const b = isCurrent ? 'Present' : fmtDate(end) || '';
  if (!a && !b) return '';
  return [a, b].filter(Boolean).join(' – ');
}

export async function buildResumePdfBuffer(docData: PdfResumeDoc): Promise<Buffer> {
  const accent = docData.themeAccent || '#0f766e';
  const template = docData.templateKey || 'classic';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: template === 'compact' ? 36 : 48,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    if (template === 'modern') {
      doc.rect(0, 0, doc.page.width, 90).fill(accent);
      doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text(docData.fullName, 48, 28, {
        width: pageWidth,
      });
      if (docData.headline) {
        doc.fontSize(11).font('Helvetica').text(docData.headline, 48, 56, { width: pageWidth });
      }
      doc.fillColor('#111111');
      doc.y = 110;
    } else {
      doc.fillColor('#111111').fontSize(20).font('Helvetica-Bold').text(docData.fullName);
      if (docData.headline) {
        doc.fontSize(11).font('Helvetica').fillColor('#444444').text(docData.headline);
      }
      if (template === 'classic') {
        doc.moveTo(doc.page.margins.left, doc.y + 6)
          .lineTo(doc.page.margins.left + pageWidth, doc.y + 6)
          .strokeColor(accent)
          .lineWidth(2)
          .stroke();
        doc.moveDown(0.8);
      } else {
        doc.moveDown(0.4);
      }
      doc.fillColor('#111111');
    }

    const contact = [
      docData.email,
      docData.phone,
      docData.city,
    ]
      .filter(Boolean)
      .join(' · ');
    if (contact) {
      doc.fontSize(9).fillColor('#555555').font('Helvetica').text(contact);
      doc.moveDown(0.6);
      doc.fillColor('#111111');
    }

    const section = (title: string) => {
      doc.moveDown(0.4);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(accent).text(title.toUpperCase());
      doc.moveDown(0.2);
      doc.fillColor('#111111').font('Helvetica').fontSize(10);
    };

    if (docData.summary) {
      section('Summary');
      doc.text(docData.summary, { width: pageWidth, align: 'left' });
    }

    if (docData.skills.length) {
      section('Skills');
      doc.text(docData.skills.join(' · '), { width: pageWidth });
    }

    if (docData.experiences.length) {
      section('Experience');
      for (const e of docData.experiences) {
        doc.font('Helvetica-Bold').text(`${e.title} · ${e.companyName}`, { width: pageWidth });
        const meta = [dateRange(e.startDate, e.endDate, e.isCurrent), e.location]
          .filter(Boolean)
          .join(' · ');
        if (meta) doc.font('Helvetica').fillColor('#555555').fontSize(9).text(meta);
        doc.fillColor('#111111').fontSize(10);
        if (e.description) {
          doc.font('Helvetica').text(e.description, { width: pageWidth });
        }
        doc.moveDown(0.35);
      }
    }

    if (docData.educations.length) {
      section('Education');
      for (const e of docData.educations) {
        doc.font('Helvetica-Bold').text(e.school, { width: pageWidth });
        const bits = [e.degree, e.field, dateRange(e.startDate, e.endDate)]
          .filter(Boolean)
          .join(' · ');
        if (bits) doc.font('Helvetica').fillColor('#555555').fontSize(9).text(bits);
        doc.fillColor('#111111').fontSize(10);
        doc.moveDown(0.25);
      }
    }

    if (docData.languages.length) {
      section('Languages');
      doc.font('Helvetica').text(
        docData.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(' · '),
        { width: pageWidth },
      );
    }

    if (docData.certifications.length) {
      section('Certifications');
      for (const c of docData.certifications) {
        doc.font('Helvetica').text(c.issuer ? `${c.name} — ${c.issuer}` : c.name, {
          width: pageWidth,
        });
      }
    }

    doc.end();
  });
}
