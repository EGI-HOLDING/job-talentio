import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { stripNullBytes } from './cv-parser';

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

function txt(value: unknown): string {
  if (value == null) return '';
  return stripNullBytes(String(value));
}

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
  return [a, b].filter(Boolean).join(' - ');
}

function resolveFontPaths(): { regular: string | null; bold: string | null } {
  const candidates = [
    join(__dirname, '..', 'assets', 'fonts'), // dist/profiles -> dist/assets/fonts (nest assets)
    join(__dirname, '..', '..', 'assets', 'fonts'), // apps/api/assets/fonts from dist/profiles
    join(process.cwd(), 'assets', 'fonts'),
    join(process.cwd(), 'src', 'assets', 'fonts'),
    join(process.cwd(), 'apps', 'api', 'assets', 'fonts'),
  ];
  for (const dir of candidates) {
    const regular = join(dir, 'NotoSans-Regular.ttf');
    const bold = join(dir, 'NotoSans-Bold.ttf');
    if (existsSync(regular) && existsSync(bold)) {
      return { regular, bold };
    }
  }
  return { regular: null, bold: null };
}

export async function buildResumePdfBuffer(docData: PdfResumeDoc): Promise<Buffer> {
  const accent = docData.themeAccent || '#0f766e';
  const template = docData.templateKey || 'classic';
  const fonts = resolveFontPaths();
  const fontRegular = fonts.regular ? 'ResumeSans' : 'Helvetica';
  const fontBold = fonts.bold ? 'ResumeSans-Bold' : 'Helvetica-Bold';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: template === 'compact' ? 36 : 48,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (fonts.regular && fonts.bold) {
      doc.registerFont('ResumeSans', fonts.regular);
      doc.registerFont('ResumeSans-Bold', fonts.bold);
    }

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const fullName = txt(docData.fullName) || 'Candidate';
    const headline = txt(docData.headline);

    if (template === 'modern') {
      doc.rect(0, 0, doc.page.width, 90).fill(accent);
      doc.fillColor('#ffffff').fontSize(22).font(fontBold).text(fullName, 48, 28, {
        width: pageWidth,
      });
      if (headline) {
        doc.fontSize(11).font(fontRegular).text(headline, 48, 56, { width: pageWidth });
      }
      doc.fillColor('#111111');
      doc.y = 110;
    } else {
      doc.fillColor('#111111').fontSize(20).font(fontBold).text(fullName);
      if (headline) {
        doc.fontSize(11).font(fontRegular).fillColor('#444444').text(headline);
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

    const contact = [txt(docData.email), txt(docData.phone), txt(docData.city)]
      .filter(Boolean)
      .join(' | ');
    if (contact) {
      doc.fontSize(9).fillColor('#555555').font(fontRegular).text(contact);
      doc.moveDown(0.6);
      doc.fillColor('#111111');
    }

    const section = (title: string) => {
      doc.moveDown(0.4);
      doc.fontSize(11).font(fontBold).fillColor(accent).text(title.toUpperCase());
      doc.moveDown(0.2);
      doc.fillColor('#111111').font(fontRegular).fontSize(10);
    };

    const summary = txt(docData.summary);
    if (summary) {
      section('Summary');
      doc.text(summary, { width: pageWidth, align: 'left' });
    }

    const skills = (docData.skills || []).map(txt).filter(Boolean);
    if (skills.length) {
      section('Skills');
      doc.text(skills.join(' | '), { width: pageWidth });
    }

    if (docData.experiences?.length) {
      section('Experience');
      for (const e of docData.experiences) {
        const line = [txt(e.title), txt(e.companyName)].filter(Boolean).join(' | ');
        if (line) doc.font(fontBold).text(line, { width: pageWidth });
        const meta = [dateRange(e.startDate, e.endDate, e.isCurrent), txt(e.location)]
          .filter(Boolean)
          .join(' | ');
        if (meta) doc.font(fontRegular).fillColor('#555555').fontSize(9).text(meta);
        doc.fillColor('#111111').fontSize(10);
        const desc = txt(e.description);
        if (desc) {
          doc.font(fontRegular).text(desc, { width: pageWidth });
        }
        doc.moveDown(0.35);
      }
    }

    if (docData.educations?.length) {
      section('Education');
      for (const e of docData.educations) {
        const school = txt(e.school);
        if (school) doc.font(fontBold).text(school, { width: pageWidth });
        const bits = [txt(e.degree), txt(e.field), dateRange(e.startDate, e.endDate)]
          .filter(Boolean)
          .join(' | ');
        if (bits) doc.font(fontRegular).fillColor('#555555').fontSize(9).text(bits);
        doc.fillColor('#111111').fontSize(10);
        doc.moveDown(0.25);
      }
    }

    if (docData.languages?.length) {
      section('Languages');
      doc.font(fontRegular).text(
        docData.languages
          .map((l) => {
            const name = txt(l.name);
            const level = txt(l.level);
            return level ? `${name} (${level})` : name;
          })
          .filter(Boolean)
          .join(' | '),
        { width: pageWidth },
      );
    }

    if (docData.certifications?.length) {
      section('Certifications');
      for (const c of docData.certifications) {
        const name = txt(c.name);
        const issuer = txt(c.issuer);
        if (!name) continue;
        doc.font(fontRegular).text(issuer ? `${name} - ${issuer}` : name, {
          width: pageWidth,
        });
      }
    }

    doc.end();
  });
}
