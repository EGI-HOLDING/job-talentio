import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { createCanvas } from '@napi-rs/canvas';
import { completeCvSource, cvRequest, decodeCvResponse, mergeCvGrades, projectCvScore, CV_RESPONSE_FORMAT, type CvCheckpoint } from './cv-assessment';
import { prepareCvDocument } from './cv-document';
import { CvProvider, cvBackoff, cvTerminal, isCvResponseId } from './cv-provider';
const PDFDocument = require('pdfkit');

function fixture(scan: boolean) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument(), chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    if (scan) {
      const canvas = createCanvas(1280, 480), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1280, 480);
      ctx.fillStyle = '#111'; ctx.font = '34px sans-serif';
      ['CV Sintetis - Hana Contoh', 'Backend Engineer | Studio Fiktif | 2021 - 2024',
        'Mengembangkan API Node.js dan pengujian integrasi.',
        'Keahlian: Node.js, PostgreSQL', 'Sertifikasi: CLOUD-TEST-2719'].forEach((line, i) => ctx.fillText(line, 28, 62 + i * 70));
      pdf.image(canvas.toBuffer('image/png'), 40, 55, { width: 520 });
    } else {
      pdf.fontSize(18).text('CV Sintetis - Ayu Contoh', 45, 40);
      pdf.fontSize(11).text('PENGALAMAN', 45, 93);
      pdf.text('KEAHLIAN', 365, 93);
      pdf.text('Graphic Designer di Studio Pelangi', 45, 116, { width: 285 });
      pdf.text('Figma, InDesign, Illustrator', 365, 116, { width: 182 });
      pdf.text('Januari 2020 - Maret 2024', 45, 134, { width: 285 });
      pdf.text('BAHASA', 365, 160);
      pdf.text('Mendesain materi kampanye dan menyiapkan berkas produksi.', 45, 160, { width: 275 });
      pdf.text('Bahasa Indonesia', 365, 180, { width: 182 });
      pdf.text('EDUKASI', 45, 225);
      pdf.text('S1 Desain Komunikasi Visual', 45, 245);
    }
    pdf.end();
  });
}

async function run(provider: CvProvider, scan: boolean) {
  const name = scan ? 'PDF scan' : 'PDF dua kolom';
  const bytes = await fixture(scan);
  const document = await prepareCvDocument(bytes, 'fixture.pdf', 'fixture.pdf');
  assert.equal(document.pages, 1);
  const checkpoint: CvCheckpoint = { stage: 'INITIAL', responseFormat: CV_RESPONSE_FORMAT, model: 'gpt-6-luna', checksum: document.checksum,
    expectedPages: document.pages, fileKind: 'PDF', grades: [] };
  const job = scan
    ? { title: 'Backend Engineer', description: 'Mengembangkan API Node.js. Pengalaman integrasi, PostgreSQL dan sertifikasi cloud relevan.' }
    : { title: 'Graphic Designer', description: 'Membuat materi kampanye. Figma, persiapan cetak dan pengalaman desain komunikasi visual relevan.' };
  const attempt = randomUUID(), started = Date.now();
  let http = await provider.create(attempt, checkpoint.model, cvRequest(checkpoint, job), document.file);
  const responseId = http.body?.id;
  assert.ok(isCvResponseId(responseId), name + ' create HTTP ' + http.status);
  let elapsed = 0, polls = 0;
  while (elapsed < 600000 && !['completed','failed','incomplete','cancelled'].includes(http.body?.status ?? '')) {
    await wait(http.status === 200 ? 5000 : cvBackoff(polls, http.retryAfter));
    http = await provider.get(responseId);
    elapsed = Date.now() - started;
    polls++;
  }
  const terminal = ['completed','failed','incomplete','cancelled'].includes(http.body?.status ?? '');
  try {
    assert.ok(terminal && http.body?.id === responseId, name + ' unresolved response ' + responseId);
    const output = cvTerminal(http.body);
    assert.equal(output.error, undefined, name + ' provider output');
    const result = decodeCvResponse(checkpoint, output.result as { source?: unknown; grades?: unknown });
    const source = result.source;
    assert.ok(completeCvSource(source, document.pages), name + ' source coverage');
    const grades = mergeCvGrades(source!, [], result.grades);
    assert.equal(grades.length, 3, name + ' grounded grades');
    const checked = projectCvScore(source!, grades, true, false);
    const normalized = checked.result.cvText.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    const expected = scan ? ['studio fiktif', 'pengujian integrasi', 'cloud-test-2719'] :
      ['studio pelangi', 'maret 2024', 'berkas produksi', 'figma', 'desain komunikasi visual'];
    assert.ok(expected.every(fragment => normalized.includes(fragment)), name + ' source facts');
    const jobBlock = source!.blocks.find(block => /studio (pelangi|fiktif)/i.test(block.text));
    assert.ok(jobBlock && !/figma, indesign|keahlian:/i.test(jobBlock.text), name + ' experience block separated from skill column');
    return { name, score: checked.score, elapsedMs: Date.now() - started, polls, assertions: expected.length + 3,
      providerMs: http.body.completed_at && http.body.created_at ? (http.body.completed_at - http.body.created_at) * 1000 : null,
      inputTokens: http.body.usage?.input_tokens, outputTokens: http.body.usage?.output_tokens };
  } finally {
    if (terminal) await provider.delete(responseId);
  }
}

async function main() {
  assert.equal(process.env.TAKA_CV_LIVE, '1', 'Explicit synthetic live opt-in required');
  const provider = new CvProvider(new ConfigService());
  assert.ok(provider.configured, 'OpenAI key missing');
  let submissions = 0;
  for (const scan of [false, true]) {
    submissions++;
    try { console.log(JSON.stringify(await run(provider, scan))); }
    catch (error) {
      console.error(error instanceof Error ? error.message : 'Live sample failed.');
      process.exitCode = 1;
      break;
    }
  }
  console.log(JSON.stringify({ suite: 'taka-cv-live', submissions }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
