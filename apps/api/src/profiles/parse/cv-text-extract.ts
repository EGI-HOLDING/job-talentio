import type { ConfigService } from "@nestjs/config";
import mammoth from "mammoth";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WordExtractor from "word-extractor";
import { validateCvDocxArchive } from './cv-archive-limit';
const nativeImport = new Function("specifier", "return import(specifier)") as (
  s: string,
) => Promise<any>;
export type CvFileKind = "pdf" | "docx" | "doc" | "other";
export type CvTextExtractResult = {
  kind: CvFileKind;
  text: string;
  ocrUsed: boolean;
};
async function bounded<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export function detectCvFileKind(
  filename: string,
  mimeType: string,
): CvFileKind {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || mimeType.includes("wordprocessingml"))
    return "docx";
  if (name.endsWith(".doc") || mimeType === "application/msword") return "doc";
  return "other";
}
type PdfPageText = { text: string; needsOcr: boolean };
async function readPdfPages(buffer: Buffer): Promise<PdfPageText[]> {
  const pdfjs = await nativeImport("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    maxImageSize: 12_000_000,
  });
  try {
    const document = await bounded<any>(loading.promise, 30_000, 'CV PDF loading timed out');
    if (document.numPages > 20)
      throw new Error("CV exceeds the 20-page parsing limit");
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n),
        content = await bounded<any>(page.getTextContent(), 30_000, 'CV PDF text extraction timed out');
      let lastY: number | undefined, lastRight: number | undefined, text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const sameLine = lastY !== undefined && Math.abs(lastY - item.transform[5]) <= Math.max(2, Math.abs(item.transform[3]) * 0.2);
        const gap = lastRight !== undefined ? item.transform[4] - lastRight : 0;
        text += (lastY === undefined ? '' : !sameLine ? '\n' : gap > Math.max(1, Math.abs(item.transform[0]) * 0.12) && !/\s$/.test(text) && !/^\s/.test(item.str) ? ' ' : '') + item.str;
        lastY = item.transform[5];
        lastRight = item.transform[4] + (item.width || 0);
        if (text.length > 500_000) throw new Error('CV contains too much text');
      }
      let needsOcr = text.trim().length < 20;
      // Scanned PDFs often have a native header/footer over an image. The
      // presence of that small text layer must not suppress OCR of the CV.
      if (!needsOcr && text.trim().length < 250) {
        const operators = await bounded<any>(page.getOperatorList(), 30_000, 'CV PDF inspection timed out');
        needsOcr = operators.fnArray.some((op: number) => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageXObjectRepeat].includes(op));
      }
      pages.push({ text, needsOcr });
      page.cleanup();
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}
async function ocrPdf(
  buffer: Buffer,
  config?: ConfigService,
  nativePages: PdfPageText[] = [],
): Promise<string> {
  const pdfjs = await nativeImport("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const { createWorker } = await import("tesseract.js");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    maxImageSize: 12_000_000,
  });
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let abandonedWorker = false;
  try {
    const deadline = Date.now() + 120_000;
    const doc = await bounded<any>(loadingTask.promise, 30_000, 'CV PDF loading timed out');
    if (doc.numPages > 20)
      throw new Error("Scanned CV exceeds the 20-page parsing limit");
    const configured = config?.get<string>("CV_PARSE_OCR_LANGS") || "eng+rus";
    const langs = /^[a-z]{3}(?:\+[a-z]{3})*$/.test(configured)
      ? configured
      : "eng+rus";
    const cachePath = join(tmpdir(), "talentio-ocr");
    mkdirSync(cachePath, { recursive: true });
    const initializing = createWorker(langs, 1, { cachePath }).then(async created => {
      if (abandonedWorker) await created.terminate();
      return created;
    });
    worker = await bounded(initializing, Math.min(60_000, deadline - Date.now()), 'CV OCR initialization timed out');
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (Date.now() >= deadline) throw new Error('CV OCR timed out');
      if (nativePages[n - 1] && !nativePages[n - 1].needsOcr) {
        pages.push(nativePages[n - 1].text);
        continue;
      }
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (!Number.isFinite(base.width * base.height) || base.width <= 0 || base.height <= 0 || base.width > 14400 || base.height > 14400) throw new Error('CV page dimensions exceed the parsing limit');
      const scale = Math.min(2.5, Math.sqrt(12_000_000 / (base.width * base.height)), 6000 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const render = page.render({
        canvas,
        canvasContext: canvas.getContext("2d"),
        viewport,
      });
      try { await bounded(render.promise, Math.max(1, Math.min(30_000, deadline - Date.now())), 'CV PDF rendering timed out'); }
      catch (error) { render.cancel(); throw error; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          worker.recognize(canvas.toBuffer("image/png")),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("CV OCR timed out")),
              Math.max(1, Math.min(30_000, deadline - Date.now())),
            );
          }),
        ]);
        pages.push(result.data.text);
      } finally {
        if (timer) clearTimeout(timer);
        page.cleanup();
      }
    }
    return pages.join("\n\n");
  } finally {
    abandonedWorker = true;
    if (worker) await worker.terminate();
    await loadingTask.destroy();
  }
}
export async function extractCvText(
  input: { buffer: Buffer; filename: string; mimeType: string },
  config?: ConfigService,
): Promise<CvTextExtractResult> {
  const kind = detectCvFileKind(input.filename, input.mimeType);
  let text = "";
  let ocrUsed = false;
  if (kind === "other")
    throw new Error("CV parsing supports PDF, DOCX and DOC files");
  if (kind === "docx") {
    validateCvDocxArchive(input.buffer);
    text = (await mammoth.extractRawText({ buffer: input.buffer })).value;
  }
  if (kind === "doc")
    text = (await new WordExtractor().extract(input.buffer)).getBody();
  if (kind === "pdf") {
    // One reader enforces the page limit for both native and scanned PDFs.
    const pageTexts = await readPdfPages(input.buffer);
    text = pageTexts.map(page => page.text).join("\n\n");
    const enabled = !["false", "0", "no", "off"].includes(
      String(config?.get("CV_PARSE_OCR") ?? "true").toLowerCase(),
    );
    if (enabled && pageTexts.some((page) => page.needsOcr)) {
      text = await ocrPdf(input.buffer, config, pageTexts);
      ocrUsed = true;
    }
  }
  text = text.replace(/\x00/g, "").trim();
  if (text.length > 500_000) throw new Error('CV contains too much text');
  if (text.length < 20)
    throw new Error(
      "No readable CV text found. Try another file or enter your experience manually.",
    );
  return { kind, text, ocrUsed };
}
