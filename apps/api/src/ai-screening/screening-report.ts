import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PDF_TEMPLATE_VERSION } from './screening.policy';
import type { CandidatePayload, EvaluationPayload, PackagePayload } from './screening.schemas';
export type ScreeningReport = {
    name: string;
    job: string;
    company: string;
    submittedAt: Date;
    methodology: string;
    jobVersion: number;
    cvScore: number | null;
    screeningScore: number | null;
    finalScore: number | null;
    result: EvaluationPayload;
    rubric: PackagePayload;
    plan: CandidatePayload;
    questionLabels?: Record<string, string>;
};
function fonts() {
    const roots = [join(__dirname, '..', 'assets', 'fonts'), join(process.cwd(), 'assets', 'fonts'), join(process.cwd(), 'apps', 'api', 'assets', 'fonts')];
    const root = roots.find(r => existsSync(join(r, 'NotoSans-Regular.ttf')) && existsSync(join(r, 'NotoSans-Bold.ttf')));
    if (!root)
        throw new Error('REPORT_FONTS_REQUIRED');
    return { regular: join(root, 'NotoSans-Regular.ttf'), bold: join(root, 'NotoSans-Bold.ttf'), logo: join(root, '..', 'brand', 'talentio.png') };
}
const claimLabels = { SUPPORTED: 'Didukung penjelasan kandidat', INSUFFICIENT: 'Belum cukup bukti', CLARIFY: 'Perlu konfirmasi HR' };
const val = (n: number | null) => n === null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
export async function renderScreeningReport(data: ScreeningReport): Promise<Buffer> {
    const f = fonts(), doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, autoFirstPage: true, info: { Title: 'Laporan screening Tara — ' + data.name, Author: 'Talentio', Subject: 'Dukungan klaim CV dan kecocokan pekerjaan' } });
    const buffers: Buffer[] = [];
    doc.on('data', b => buffers.push(b));
    const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(buffers))); doc.on('error', reject); });
    doc.registerFont('Body', f.regular);
    doc.registerFont('Bold', f.bold);
    const navy = '#17213a', purple = '#5635e8', muted = '#697b99', line = '#e7ebf3', width = doc.page.width - 88;
    const text = (value: string, x: number, y: number, w: number, size = 10.5, bold = false, color = navy) => {
        doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color);
        const h = doc.heightOfString(value, { width: w, lineGap: 2 });
        doc.text(value, x, y, { width: w, lineGap: 2 });
        return h;
    };
    const heading = (value: string, y: number) => text(value, 44, y, width, 11, true);
    const rule = (y: number) => doc.moveTo(44, y).lineTo(doc.page.width - 44, y).strokeColor(line).lineWidth(.7).stroke();
    const header = (label: string) => {
        doc.image(f.logo, 44, 34, { fit: [132, 32] });
        text('TARA / SCREENING', 360, 40, 190, 9, true, muted);
        rule(74);
        text(label, 44, 90, width, 19, true);
    };
    header('Ringkasan penilaian kandidat');
    let y = 127;
    y += text(data.name, 44, y, width, 16, true) + 7;
    y += text(data.job + ' · ' + data.company, 44, y, width, 10.5, false, muted) + 5;
    y += text('Lamaran ' + data.submittedAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · Kebutuhan lowongan v' + data.jobVersion, 44, y, width, 9, false, muted) + 20;
    const gap = 12, card = (width - 2 * gap) / 3;
    for (const [i, [label, n]] of [['Skor akhir', data.finalScore], ['Kecocokan CV', data.cvScore], ['Screening Tara', data.screeningScore]].entries()) {
        const x = 44 + i * (card + gap);
        doc.roundedRect(x, y, card, 78, 7).fill(i === 0 ? '#f1edff' : '#f8fafd');
        text(String(label), x + 12, y + 12, card - 24, 9, true, muted);
        text(val(n as number | null), x + 12, y + 30, card - 24, 24, true, i === 0 ? purple : navy);
    }
    y += 98;
    if (data.finalScore === null)
        y += text('Penilaian perlu tinjauan: skor akhir belum tersedia karena sebagian bukti belum dapat dinilai.', 44, y, width, 10, false, muted) + 12;
    heading('Yang perlu diketahui HR', y);
    y += 24;
    y += text(data.result.summary, 44, y, width, 10.5) + 22;
    const column = (width - 24) / 2;
    const bullets = (title: string, items: string[], x: number, start: number) => {
        text(title, x, start, column, 11, true);
        let next = start + 26;
        for (const item of items.length ? items : ['Belum ada bukti yang cukup untuk dirangkum.']) {
            next += text('• ' + item, x, next, column, 10.5) + 12;
        }
        return next;
    };
    y = Math.max(bullets('Kekuatan yang didukung', data.result.strengths, 44, y), bullets('Prioritas konfirmasi', data.result.gaps, 44 + column + 24, y)) + 20;
    rule(y);
    y += 17;
    y += text('Cara membaca hasil', 44, y, width, 10.5, true) + 8;
    text('Skor akhir menggabungkan kecocokan CV dan bukti screening dengan bobot 50:50. Jawaban membantu menilai dukungan klaim, bukan membuktikan kebenaran faktual. Keputusan rekrutmen tetap dilakukan HR.', 44, y, width, 9.5, false, muted);
    doc.addPage();
    header('Bukti dan tindak lanjut');
    y = 119;
    for (const c of data.rubric.criteria) {
        const result = data.result.criteria.find(r => r.criterionId === c.id)!;
        const claims = data.result.claims.filter(r => data.plan.claims.find(cl => cl.id === r.claimId)?.criterionId === c.id);
        const excerpt = (value: string, n = 80) => value.length > n ? value.slice(0, n).trimEnd() + '…' : value;
        const evidence = result.evidence[0];
        const lines = [result.reason, ...claims.map(cl => {
                const source = data.plan.claims.find(v => v.id === cl.claimId)!;
                if (cl.status === 'CLARIFY' && cl.contradictions[0]) {
                    const pair = cl.contradictions[0], label = (ref: typeof pair.left) => ref.source === 'CV' ? 'CV' : data.questionLabels?.[ref.ref] ?? 'Jawaban';
                    return claimLabels[cl.status] + ': ' + label(pair.left) + ' “' + excerpt(pair.left.quote, 70) + '” / ' + label(pair.right) + ' “' + excerpt(pair.right.quote, 70) + '”';
                }
                return 'CV: “' + excerpt(source.quote) + '” · ' + claimLabels[cl.status];
            }), !claims.length ? 'Tidak ada klaim CV terpilih untuk kompetensi ini.' : null,
            evidence ? 'Jawaban ' + (data.questionLabels?.[evidence.questionId] ?? '[' + evidence.questionId.slice(-6) + ']') + ': “' + excerpt(evidence.quote) + '”' : null].filter(Boolean).join('\n');
        const titleHeight = doc.font('Bold').fontSize(10).heightOfString(c.name, { width: width - 64 });
        const rowHeight = titleHeight + doc.font('Body').fontSize(9.5).heightOfString(lines, { width: width - 20, lineGap: 2 }) + 20;
        if (y + rowHeight > 650)
            throw new Error('REPORT_LAYOUT_OVERFLOW');
        doc.roundedRect(44, y, width, rowHeight, 5).fill('#f8fafd');
        text(c.name, 54, y + 8, width - 64, 10, true);
        text(result.score === null ? '—' : String(result.score) + '/4', doc.page.width - 91, y + 8, 37, 10, true, purple);
        text(lines, 54, y + titleHeight + 12, width - 20, 9.5);
        y += rowHeight + 5;
    }
    heading('Pertanyaan lanjutan untuk HR', y + 5);
    y += 25;
    for (const q of data.result.interviewQuestions.length ? data.result.interviewQuestions : ['Konfirmasikan pengalaman yang belum memiliki bukti cukup melalui wawancara.']) {
        y += text('• ' + q, 44, y, width, 10) + 8;
    }
    if (y > 760 || doc.bufferedPageRange().count !== 2)
        throw new Error('REPORT_LAYOUT_OVERFLOW:' + Math.ceil(y) + ':' + doc.bufferedPageRange().count);
    for (let page = 0; page < 2; page++) {
        doc.switchToPage(page);
        doc.page.margins.bottom = 0;
        rule(778);
        text('Rahasia · Untuk HR perusahaan terkait', 44, 788, 260, 8, false, muted);
        text((page + 1) + ' / 2', 490, 788, 60, 8, false, muted);
        text(data.methodology + ' · ' + PDF_TEMPLATE_VERSION, 44, 803, width, 7, false, muted);
    }
    doc.end();
    return done;
}
