import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
import { prepareCvDocument } from './cv-document';

const Zip = createRequire(require.resolve('mammoth'))('jszip');

async function makeDocx(withImage: boolean) {
  const zip = new Zip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const image = withImage ? '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="4550000" cy="920000"/><wp:docPr id="1" name="Certificate"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="certificate.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4550000" cy="920000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' : '';
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>CV Sintetis. Engineer di Studio Fiktif, 2021–2024. Mengelola deployment Kubernetes.</w:t></w:r></w:p>' + image + '<w:sectPr/></w:body></w:document>');
  if (withImage) {
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/certificate.png"/></Relationships>');
    const canvas = createCanvas(800, 160), ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 160);
    ctx.fillStyle = 'black'; ctx.font = '28px sans-serif';
    ctx.fillText('Sertifikasi: KUBE-SYNTH-2024', 20, 75);
    zip.file('word/media/certificate.png', canvas.toBuffer('image/png'));
  }
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

async function main() {
  const plain = await prepareCvDocument(await makeDocx(false), 'fixture.docx', 'fixture.docx');
  assert.equal(plain.fileKind, 'WORD_TEXT');
  assert.equal(plain.wordVisualFallback, false);
  const image = await makeDocx(true);
  const fallback = await prepareCvDocument(image, 'fixture.docx', 'fixture.docx');
  assert.equal(fallback.fileKind, 'WORD_TEXT');
  assert.equal(fallback.wordVisualFallback, true);
  const url = process.env.TAKA_LOCAL_RENDERER;
  if (url) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/render$/);
    const rendered = await prepareCvDocument(image, 'fixture.docx', 'fixture.docx', url);
    assert.equal(rendered.fileKind, 'WORD_VISUAL');
    assert.equal(rendered.checksum, fallback.checksum);
    assert.equal(rendered.pages, 1);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({ data: new Uint8Array(Buffer.from(rendered.file.file_data.split(',')[1], 'base64')), verbosity: 0 });
    try {
      const doc = await loading.promise, page = await doc.getPage(1), ops = await page.getOperatorList();
      assert.ok(ops.fnArray.some(op => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject].includes(op)), 'DOCX certificate image remains in rendered PDF');
      const text = await page.getTextContent();
      assert.ok(text.items.some(item => 'str' in item && item.str.includes('Studio Fiktif')));
    } finally { await loading.destroy(); }
    const legacy = await readFile('scripts/fixtures/cv/word-extractor-sample.doc');
    const legacyPdf = await prepareCvDocument(legacy, 'fixture.doc', 'fixture.doc', url);
    assert.equal(legacyPdf.fileKind, 'WORD_VISUAL');
    assert.ok(legacyPdf.pages);
  }
  console.log('Taka document formats:', { plainDocx: true, fallbackRecorded: true, realWordRendering: Boolean(url), paidCalls: 0 });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
