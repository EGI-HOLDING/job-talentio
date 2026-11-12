import { validateCvDocxArchive } from '../../profiles/parse/cv-archive-limit';
import type { CvFileKind } from './cv-assessment';
import { CV_MAX_BYTES, fileChecksum, validateCvBytes } from './cv-scoring.policy';

const PDF = 'application/pdf';
const RENDER_MAX_BYTES = 20 * 1024 * 1024;
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

async function inspectPdf(bytes: Buffer, targets: number[]): Promise<{ pages: number | null; subset: Uint8Array | null }> {
  const pdfjs = await nativeImport('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pages: number | null = null;
  let subset: Uint8Array | null = null;
  try {
    const inspect = async () => {
      const document = await loading.promise;
      pages = document.numPages <= 1000 ? document.numPages : null;
      if (pages && targets.length && targets.length < pages && targets.every(page => page >= 1 && page <= pages!)) {
        subset = await document.extractPages([{ document: null, includePages: targets.map(page => page - 1) }]);
      }
    };
    await Promise.race([inspect(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('CV_PDF_INSPECTION_TIMEOUT')), 8000);
    })]);
  } catch (error) {
    if (error instanceof Error && ['InvalidPDFException', 'PasswordException'].includes(error.name)) throw new Error('CV_FILE_INVALID');
  }
  finally { clearTimeout(timer); await loading.destroy().catch(() => undefined); }
  return { pages, subset };
}

async function renderWord(url: string | undefined, buffer: Buffer, extension: string) {
  if (!url) return null;
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
      headers: { 'Content-Type': 'application/octet-stream', 'X-Document-Format': extension },
      body: new Uint8Array(buffer) });
    if (!response.ok || response.headers.get('content-type') !== PDF || !response.body ||
      Number(response.headers.get('content-length')) > RENDER_MAX_BYTES) {
      await response.body?.cancel();
      return null;
    }
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > RENDER_MAX_BYTES) return null;
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const rendered = Buffer.concat(chunks);
    return rendered.subarray(0, 5).toString() === '%PDF-' ? rendered : null;
  } catch { return null; }
}

export type CvProviderFile = { type: 'input_file'; filename: string; file_data: string; detail?: 'auto' };
export async function prepareCvDocument(buffer: Buffer, name: string, fileKey: string, rendererUrl?: string, previous?: CvFileKind, targets: number[] = []) {
  const ext = fileKey.split('.').at(-1)?.toLowerCase();
  const filename = /\.(pdf|docx?)$/i.test(name) ? name : name + '.' + (ext === 'doc' || ext === 'docx' ? ext : 'pdf');
  const mime = validateCvBytes(buffer, filename);
  const checksum = fileChecksum(buffer);
  const extension = filename.split('.').at(-1)!.toLowerCase();
  const hasVisual = extension === 'doc' || (extension === 'docx' && validateCvDocxArchive(buffer).hasMedia);
  const rendition = hasVisual && previous !== 'WORD_TEXT' ? await renderWord(rendererUrl, buffer, extension) : null;
  if (previous === 'WORD_VISUAL' && !rendition) throw new Error('CV_RENDERER_UNAVAILABLE');
  const pdf = rendition ?? (mime === PDF ? buffer : null);
  const fileKind: CvFileKind = rendition ? 'WORD_VISUAL' : pdf ? 'PDF' : 'WORD_TEXT';
  const inspected = pdf ? await inspectPdf(pdf, targets) : { pages: 1, subset: null };
  const pages = inspected.pages;
  const payload = inspected.subset ? Buffer.from(inspected.subset) : pdf ?? buffer;
  const file: CvProviderFile = { type: 'input_file', filename: rendition ? 'cv.pdf' : 'cv.' + extension,
    file_data: 'data:' + (pdf ? PDF : mime) + ';base64,' + payload.toString('base64'), ...(pdf ? { detail: 'auto' } : {}) };
  return { file, checksum, fileKind, pages, pagesInFile: inspected.subset ? targets : [], bytes: buffer.length, wordVisualFallback: hasVisual && !rendition };
}

export { CV_MAX_BYTES };
