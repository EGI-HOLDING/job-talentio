import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PDF_TEMPLATE_VERSION } from './screening.policy';
import type { CandidatePayload, EvaluationPayload, PackagePayload } from './screening.schemas';
import { taraOutcomeLabel } from './tara-interview';
import { TAKA_ROLE_EVIDENCE_VERSION, TAKA_ROLE_VALIDATION_VERSION } from './taka-versions';
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
    independentScores?: boolean;
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
const coverageLabels = {
    NOT_ASKED: 'Belum dibahas', INSUFFICIENT_OPPORTUNITY: 'Kesempatan belum cukup',
    TECHNICAL_INTERRUPTION: 'Kesempatan terpotong', PLAYBACK_UNVERIFIED: 'Pemutaran belum terverifikasi', ASSESSMENT_UNAVAILABLE: 'Penilaian perlu ditinjau',
};
const fieldLabels = { TASK: 'tugas', ACTION: 'tindakan pribadi', CONTEXT: 'konteks pengalaman', RESULT: 'hasil', ROLE_BOUNDARY: 'batas tanggung jawab' };
const val = (n: number | null) => n === null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
export async function renderScreeningReport(data: ScreeningReport): Promise<Buffer> {
    const f = fonts(), doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, autoFirstPage: true, info: { Title: 'Laporan screening Tara — ' + data.name, Author: 'Talentio', Subject: 'Dukungan klaim CV dan kecocokan pekerjaan' } });
    const buffers: Buffer[] = [];
    doc.on('data', b => buffers.push(b));
    const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(buffers))); doc.on('error', reject); });
    doc.registerFont('Body', f.regular);
    doc.registerFont('Bold', f.bold);
    const navy = '#17213a', purple = '#5635e8', muted = '#697b99', line = '#e7ebf3', width = doc.page.width - 88;
    const text = (value: string, x: number, y: number, w: number, size = 10.5, bold = false, color = navy, lineGap = 2) => {
        doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color);
        const h = doc.heightOfString(value, { width: w, lineGap });
        doc.text(value, x, y, { width: w, lineGap });
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
    header(data.independentScores?'Ringkasan screening':'Ringkasan penilaian kandidat');
    let y = 127;
    y += text(data.name, 44, y, width, 16, true) + 7;
    y += text(data.job + (data.independentScores?'':' · '+data.company), 44, y, width, 10.5, false, muted) + 5;
    y += text((data.independentScores?data.company+' · ':'Lamaran ')+data.submittedAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })+(data.independentScores?'':' · Kebutuhan lowongan v'+data.jobVersion),44,y,width,9,false,muted)+16;
    const voice=(data.result as unknown as {voice?:{partial:boolean;testedClaims:number;totalClaims:number;durationSeconds:number;transcriptComplete:boolean}}).voice;
    const alternative=data.result.taraInterview?.topics.some(topic=>topic.alternative);
    const assessment=data.result.interviewAssessment;
    const role = data.result.roleAssessment;
    const notice=!role && (assessment?.state==='NO_ASSESSABLE_CLAIMS'?'Belum ada klaim yang dapat dinilai':
        assessment?.state==='PARTIAL'||!assessment&&voice?.partial?'Hasil parsial — perlu ditinjau HR':null);
    if(notice){doc.roundedRect(44,y,230,23,5).fill('#fff2dc');text(notice,52,y+5,214,9,true,'#96621c');y+=33;}
    if (role) {
        y += text(role.score === null ? 'Skor akhir belum lengkap' : 'Skor akhir ' + val(role.score) + ' / 100', 44, y, width, 19, true, purple) + 7;
        const missing = { CV: 'Penilaian CV belum tersedia untuk rubrik ini.', RUBRIC: 'Lowongan belum memiliki kompetensi inti terstruktur.',
            COVERAGE: 'Sebagian kompetensi belum memiliki bukti atau kesempatan menjawab yang cukup.' };
        if (role.missing.length) y += text(role.missing.map(key => missing[key]).join(' '), 44, y, width, 10, false, muted) + 8;
        if (role.partial) y += text(`${val(role.partial.competency)} / 100 kompetensi (parsial) · Kejelasan ${val(role.partial.explanation)} / 100 (parsial)`,
            44, y, width, 10, true) + 8;
        y += text(role.coverage.assessed + ' dari ' + role.coverage.total + ' kompetensi inti dinilai · Rubrik ' + role.rubricRevision.slice(0, 8), 44, y, width, 9, false, muted) + 16;
    }
    const labels = [['cv','Kecocokan CV'],['competency','Kompetensi kerja'],['explanation','Kejelasan penjelasan']] as const;
    const scores = role ? labels.map(([key, label]) => [label + ' · ' + role.weights[key] + '%', role.components[key]] as const) :
        data.independentScores ? [['Kecocokan CV',data.cvScore],['Dukungan klaim CV',data.screeningScore]] : [['Skor gabungan', data.finalScore], ['Kecocokan CV', data.cvScore], ['Dukungan klaim CV', data.screeningScore]];
    const gap = 12, card = (width - (scores.length - 1) * gap) / scores.length;
    for (const [i, [label, n]] of scores.entries()) {
        const x = 44 + i * (card + gap);
        doc.roundedRect(x, y, card, 78, 7).fill(i === 0 ? '#f1edff' : '#f8fafd');
        text(String(label), x + 12, y + 12, card - 24, 9, true, muted);
        if (role) {
            const key = labels[i][0], points = role.contributions[key];
            text(n === null ? 'Belum lengkap' : val(n as number) + ' / 100', x + 12, y + 28, card - 24, 15, true, i === 0 ? purple : navy);
            if (points !== null) text(points.toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' poin', x + 12, y + 52, card - 24, 9, false, muted);
        } else text(val(n as number | null) + (data.independentScores && n !== null ? ' / 100' : ''), x + 12, y + 30, card - 24, 24, true, i === 0 ? purple : navy);
    }
    y += 98;
    if (role) {
        heading('Ringkasan', y);
        y += text(data.result.summary, 44, y + 22, width, 10) + 28;
        if (role.coverage.interrupted) text('Sebagian rekaman wawancara mungkin tidak tersedia.', 44, y, width, 9.5, false, muted);
    } else if(data.independentScores){
        const duration=voice?' · Durasi '+Math.floor(voice.durationSeconds/60)+':'+String(voice.durationSeconds%60).padStart(2,'0')+(voice.transcriptComplete?'':' · Transkrip tidak lengkap'):'';
        if(assessment){
            const label=assessment.state==='ALTERNATIVE'?'Pengalaman di luar CV':assessment.assessedClaims+' dari '+assessment.plannedClaims+' klaim dinilai';
            y+=text(label+duration+' · '+assessment.version,44,y,width,9,false,muted)+14;
        }else if(voice)y+=text((alternative?'Pengalaman di luar CV':voice.testedClaims+'/'+voice.totalClaims+' klaim diuji')+duration,44,y,width,9,false,muted)+14;
        heading('Ringkasan',y);y+=22;y+=text(data.result.summary,44,y,width,10)+16;
        heading('Bukti terpilih',y);y+=24;
        const selected=data.result.claims.filter(c=>assessment?c.score!=null:(c as unknown as {asked?:boolean}).asked!==false).slice(0,3);
        for(const claim of selected){
            const source=data.plan.claims.find(c=>c.id===claim.claimId),title=source?.statement??'Klaim CV',evidence=claim.evidence[0];
            const body=evidence?'Jawaban: '+evidence.quote.slice(0,155)+(evidence.quote.length>155?'…':''):claim.reason;
            const height=doc.font('Body').fontSize(9.5).heightOfString(body,{width:width-20})+doc.font('Bold').fontSize(10).heightOfString(title,{width:width-64})+24;
            if(y+height>720){doc.addPage();header('Ringkasan screening (lanjutan)');y=120;}
            text(title,52,y,width-68,10,true);text(claim.score==null?'—':claim.score+'/4',doc.page.width-83,y,35,10,true,purple);
            text(body,52,y+doc.font('Bold').fontSize(10).heightOfString(title,{width:width-64})+6,width-20,9.5);
            y+=height;rule(y-8);
        }
        if(y>650){doc.addPage();header('Prioritas tindak lanjut');y=120;}else{heading('Prioritas tindak lanjut',y+3);y+=28;}
        for(const [i,q] of data.result.interviewQuestions.slice(0,3).entries()){y+=text((i+1)+'. '+q,44,y,width,9.5)+7;}
    }else{
    if (!data.independentScores && data.finalScore === null)
        y += text(alternative?'Wawancara ini mencatat pengalaman di luar CV tanpa skor klaim.':'Skor gabungan belum tersedia. Periksa status pemrosesan CV dan evaluasi pada detail lamaran.', 44, y, width, 10, false, muted) + 12;
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
    text((data.independentScores ? 'Kecocokan CV dan hasil screening dinilai terpisah, tidak digabung menjadi peringkat baru. ' : 'Skor gabungan: 50% kecocokan CV + 50% dukungan klaim yang diperiksa. ')+ ' Nilai 0 berarti penjelasan belum mendukung klaim; bukan vonis kebohongan. Cakupan screening terbatas pada klaim terpilih. Keputusan rekrutmen tetap dilakukan HR.', 44, y, width, 9.5, false, muted);
    }
    doc.addPage();
    header('Bukti dan tindak lanjut');
    y = 119;
    if (data.result.taraInterview) {
        heading('Catatan wawancara Tara', y);
        y += 22;
        for (const topic of data.result.taraInterview.topics) {
            if (y > 650) { doc.addPage(); header('Catatan wawancara Tara'); y = 119; }
            y += text((topic.alternative ? 'Pengalaman di luar CV · ' : '') + topic.label, 44, y, width, 10, true) + 3;
            y += text(taraOutcomeLabel[topic.outcome], 44, y, width, 9.5) + 3;
            if (topic.opportunities?.some(item=>item.delivery==='TEXT_FALLBACK'))
                y += text('Pertanyaan disampaikan lewat teks saat wawancara suara.', 44, y, width, 9, false, muted) + 3;
            const quotes = topic.evidence?.length ? topic.evidence.slice(0,2).map(item=>item.quote) : topic.quote ? [topic.quote] : [];
            for (const quote of quotes) y += text('“' + quote.slice(0,240) + (quote.length>240?'…':'') + '”', 44, y, width, 9.5, false, muted) + 3;
            y += 7;
        }
    }
    const excerpt = (value: string, n = 90) => value.length > n ? value.slice(0, n).trimEnd() + '…' : value;
    const modern = data.result.claims.length > 0 && data.result.claims.every(c => 'score' in c);
    const fullRoleQuotes = role?.version === TAKA_ROLE_EVIDENCE_VERSION || role?.version === TAKA_ROLE_VALIDATION_VERSION;
    const records: Array<{ title: string; score: number | null; reason: string; quote?: string; evidence?: { questionId: string; quote: string };
        quotes?: Array<{ questionId: string; quote: string }>; pair?: EvaluationPayload['claims'][number]['contradictions'][number]; status: string }> =
        role ? role.criteria.map(row => ({ title: row.name, score: row.level, reason: row.reason,
        quote: undefined as string | undefined, evidence: row.evidence[0], quotes: fullRoleQuotes ? row.evidence : undefined, pair: row.discrepancy,
        status: row.state === 'ASSESSED' ? 'Kejelasan ' + row.clarity + '/4' : coverageLabels[row.state] })) :
        modern ? data.result.claims.map((result, i) => ({ title: 'Klaim ' + (i + 1), score: result.score ?? null,
        reason: result.reason + (result.score != null && result.assessment?.openFields.length
            ? '\nBelum dibahas · ' + result.assessment.openFields.map(field => fieldLabels[field]).join(', ') : ''),
        quote: data.plan.claims.find(c => c.id === result.claimId)?.quote, evidence: result.evidence[0],
        status: result.assessment && result.assessment.state !== 'ASSESSED' ? coverageLabels[result.assessment.state] : claimLabels[result.status], pair: result.contradictions[0] })) :
        data.result.criteria.map(c => ({ title: data.rubric.criteria.find(r => r.id === c.criterionId)?.name ?? 'Kompetensi', score: c.score, reason: c.reason, quote: undefined as string | undefined, evidence: c.evidence[0], status: 'Metodologi sebelumnya', pair: undefined as EvaluationPayload['claims'][number]['contradictions'][number] | undefined }));
    const columns = records.length > 3 ? 2 : 1;
    for (let index = 0; index < records.length; index += columns) {
        const group = records.slice(index, index + columns), cardWidth = group.length === 1 ? width : (width - 12) / 2;
        const layouts = group.map(result => {
            const label = (ref: { source: string; ref: string }) => ref.source === 'CV' ? 'CV' : data.questionLabels?.[ref.ref] ?? 'Jawaban';
            // A discrepancy already contains its source evidence. Do not repeat the
            // same CV/answer excerpts and crowd out other claims on the report.
            const pairHasCv = result.pair && [result.pair.left, result.pair.right].some(s => s.source === 'CV');
            const quotedAnswers = result.quotes?.map(evidence =>
                (data.questionLabels?.[evidence.questionId] ?? 'Jawaban') + ' · “' + evidence.quote + '”') ?? [];
            const lines = [result.status + ' · ' + result.reason,
                result.quote && !pairHasCv ? 'CV: “' + excerpt(result.quote, 70) + '”' : null,
                ...quotedAnswers,
                !fullRoleQuotes && !result.pair && result.evidence ? (data.questionLabels?.[result.evidence.questionId] ?? 'Jawaban') + ': “' + excerpt(result.evidence.quote, 70) + '”' : !result.pair && modern ? 'Tidak ada jawaban yang dapat dikutip.' : null,
                result.pair ? label(result.pair.left) + ': “' + excerpt(result.pair.left.quote, 65) + '”\n' + label(result.pair.right) + ': “' + excerpt(result.pair.right.quote, 65) + '”' : null].filter(Boolean).join('\n');
            const titleHeight = doc.font('Bold').fontSize(10).heightOfString(result.title, { width: cardWidth - 64 });
            const rowHeight = titleHeight + doc.font('Body').fontSize(9.5).heightOfString(lines, { width: cardWidth - 20, lineGap: 0 }) + 20;
            return { result, lines, titleHeight, rowHeight };
        });
        const rowHeight = Math.max(...layouts.map(layout => layout.rowHeight));
        if (y + rowHeight > 650) { doc.addPage(); header('Bukti dan tindak lanjut (lanjutan)'); y = 119; }
        layouts.forEach(({ result, lines, titleHeight }, column) => {
            const x = 44 + column * (cardWidth + 12);
            doc.roundedRect(x, y, cardWidth, rowHeight, 5).fill('#f8fafd');
            text(result.title, x + 10, y + 8, cardWidth - 64, 10, true);
            text(result.score === null ? '—' : String(result.score) + '/4', x + cardWidth - 47, y + 8, 37, 10, true, purple);
            text(lines, x + 10, y + titleHeight + 12, cardWidth - 20, 9.5, false, navy, 0);
        });
        y += rowHeight + 8;
    }
    if (y > 600) { doc.addPage(); header('Tindak lanjut untuk HR'); y = 119; }
    heading('Pertanyaan lanjutan untuk HR', y + 5);
    y += 25;
    const followUps = data.result.interviewQuestions.length ? data.result.interviewQuestions : ['Konfirmasikan pengalaman yang belum memiliki bukti cukup melalui wawancara.'];
    const followUpWidth = (width - 12 * (followUps.length - 1)) / followUps.length;
    y += Math.max(...followUps.map((q, i) => text((i + 1) + '. ' + q, 44 + i * (followUpWidth + 12), y, followUpWidth, 9.5))) + 8;
    if (y > 760)
        throw new Error('REPORT_LAYOUT_OVERFLOW:' + Math.ceil(y) + ':' + doc.bufferedPageRange().count);
    const pageCount = doc.bufferedPageRange().count;
    for (let page = 0; page < pageCount; page++) {
        doc.switchToPage(page);
        doc.page.margins.bottom = 0;
        rule(778);
        text('Rahasia · Untuk HR perusahaan terkait', 44, 788, 260, 8, false, muted);
        text((page + 1) + ' / ' + pageCount, 490, 788, 60, 8, false, muted);
        text(data.methodology + ' · ' + PDF_TEMPLATE_VERSION, 44, 803, width, 7, false, muted);
    }
    doc.end();
    return done;
}
