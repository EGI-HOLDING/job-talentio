import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import mammoth from 'mammoth';
import { parseCvText, stripNullBytesDeep } from '../../cv-parser';
import type { CvParseProvider } from '../cv-parse.provider';
import type { CvParseProviderInput, ParsedCvData } from '../cv-parse.types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const THIN_TEXT_CHARS = 80;
const OCR_TIMEOUT_MS = 30_000;

export class LocalCvParseProvider implements CvParseProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalCvParseProvider.name);

  constructor(private config?: ConfigService) {}

  private ocrEnabled() {
    const raw = this.config?.get<string>('CV_PARSE_OCR');
    if (raw === undefined || raw === null || raw === '') return true;
    return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
  }

  /** Tesseract lang string, e.g. eng+rus. Safe subset only. */
  private ocrLangs() {
    const raw = (this.config?.get<string>('CV_PARSE_OCR_LANGS') || 'eng+rus').trim().toLowerCase();
    if (/^[a-z]{3}(?:\+[a-z]{3})*$/.test(raw)) return raw;
    return 'eng+rus';
  }

  async parse(input: CvParseProviderInput): Promise<ParsedCvData> {
    const kind = detectKind(input.filename, input.mimeType);
    let text = '';
    let ocrUsed = false;

    if (kind === 'pdf') {
      const extracted = await this.extractPdfText(input.buffer);
      text = extracted;
      if (extracted.trim().length < THIN_TEXT_CHARS && this.ocrEnabled()) {
        const ocrText = await this.ocrThinPdf(input.buffer);
        if (ocrText && ocrText.trim().length > extracted.trim().length) {
          text = ocrText;
          ocrUsed = true;
        }
      }
    } else if (kind === 'docx') {
      text = await this.extractDocxText(input.buffer);
    } else {
      const parsed = stripNullBytesDeep(
        parseCvText('', input.knownSkills),
      );
      return {
        ...parsed,
        textPreview:
          'Structured parse supports PDF and DOCX; file is stored for download.',
        meta: { provider: this.name, ocrUsed: false },
      };
    }

    const parsed = stripNullBytesDeep(parseCvText(text, input.knownSkills));
    return {
      ...parsed,
      meta: { provider: this.name, ocrUsed },
    };
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    try {
      const result = await pdfParse(buffer);
      return result.text || '';
    } catch (err) {
      this.logger.warn(`pdf-parse failed: ${(err as Error).message}`);
      return '';
    }
  }

  private async extractDocxText(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch (err) {
      this.logger.warn(`mammoth DOCX extract failed: ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * OCR fallback for scanned/thin PDFs. Rasterizes page 1 when canvas is available;
   * soft-fails otherwise so parse still completes.
   */
  private async ocrThinPdf(buffer: Buffer): Promise<string | null> {
    try {
      const png = await rasterizePdfFirstPage(buffer);
      if (!png) return null;

      const Tesseract = await import('tesseract.js');
      const langs = this.ocrLangs();
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
      this.logger.warn(`OCR fallback skipped: ${(err as Error).message}`);
      return null;
    }
  }
}

function detectKind(
  filename: string,
  mimeType: string,
): 'pdf' | 'docx' | 'other' {
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
    // pdfjs-dist v4+ RenderParameters require both canvas and canvasContext.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas.toBuffer('image/png');
  } catch {
    // Soft-fail: scanned PDF OCR needs canvas; environments without it still parse digital PDFs.
    return null;
  }
}
