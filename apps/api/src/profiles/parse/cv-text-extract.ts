import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import mammoth from 'mammoth';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const THIN_TEXT_CHARS = 80;
const OCR_TIMEOUT_MS = 30_000;

export type CvFileKind = 'pdf' | 'docx' | 'other';

export type CvTextExtractResult = {
  kind: CvFileKind;
  text: string;
  ocrUsed: boolean;
};

const logger = new Logger('CvTextExtract');

export function detectCvFileKind(filename: string, mimeType: string): CvFileKind {
  const name = (filename || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    return 'docx';
  }
  return 'other';
}

function ocrEnabled(config?: ConfigService) {
  const raw = config?.get<string>('CV_PARSE_OCR');
  if (raw === undefined || raw === null || raw === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

/** Tesseract lang string, e.g. eng+rus. Safe subset only. */
function ocrLangs(config?: ConfigService) {
  const raw = (config?.get<string>('CV_PARSE_OCR_LANGS') || 'eng+rus').trim().toLowerCase();
  if (/^[a-z]{3}(?:\+[a-z]{3})*$/.test(raw)) return raw;
  return 'eng+rus';
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    return result.text || '';
  } catch (err) {
    logger.warn(`pdf-parse failed: ${(err as Error).message}`);
    return '';
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (err) {
    logger.warn(`mammoth DOCX extract failed: ${(err as Error).message}`);
    return '';
  }
}

/**
 * OCR fallback for scanned/thin PDFs. Rasterizes page 1 when canvas is available;
 * soft-fails otherwise so parse still completes.
 */
async function ocrThinPdf(buffer: Buffer, config?: ConfigService): Promise<string | null> {
  try {
    const png = await rasterizePdfFirstPage(buffer);
    if (!png) return null;

    const Tesseract = await import('tesseract.js');
    const langs = ocrLangs(config);
    const recognize = Tesseract.recognize(png, langs, {
      logger: () => undefined,
    });
    const result = await Promise.race([
      recognize,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS),
      ),
    ]);
    return result.data?.text || null;
  } catch (err) {
    logger.warn(`OCR fallback skipped: ${(err as Error).message}`);
    return null;
  }
}

async function rasterizePdfFirstPage(buffer: Buffer): Promise<Buffer | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const canvasMod = await import('@napi-rs/canvas');
    const data = new Uint8Array(buffer);
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    if (doc.numPages < 1) return null;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = canvasMod.createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext('2d');
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas.toBuffer('image/png');
  } catch {
    return null;
  }
}

/** Extract plain text from a CV buffer (PDF/DOCX + optional OCR). */
export async function extractCvText(
  input: { buffer: Buffer; filename: string; mimeType: string },
  config?: ConfigService,
): Promise<CvTextExtractResult> {
  const kind = detectCvFileKind(input.filename, input.mimeType);
  if (kind === 'other') {
    return { kind, text: '', ocrUsed: false };
  }

  if (kind === 'docx') {
    return { kind, text: await extractDocxText(input.buffer), ocrUsed: false };
  }

  const extracted = await extractPdfText(input.buffer);
  let text = extracted;
  let ocrUsed = false;
  if (extracted.trim().length < THIN_TEXT_CHARS && ocrEnabled(config)) {
    const ocrText = await ocrThinPdf(input.buffer, config);
    if (ocrText && ocrText.trim().length > extracted.trim().length) {
      text = ocrText;
      ocrUsed = true;
    }
  }
  return { kind, text, ocrUsed };
}
