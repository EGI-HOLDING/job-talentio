import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { LocalCvParseProvider } from "../apps/api/src/profiles/parse/providers/local-cv-parse.provider";
import { extractCvText } from "../apps/api/src/profiles/parse/cv-text-extract";
const apiRequire = createRequire(path.resolve("apps/api/package.json"));
const PDFDocument = apiRequire("pdfkit");
const JSZip = createRequire(apiRequire.resolve("mammoth"))("jszip");
const { createCanvas } = apiRequire("@napi-rs/canvas");
const directory = path.resolve(
  "node_modules/.cache/employee-onboarding/fixtures",
);
fs.mkdirSync(directory, { recursive: true });
const cv = [
  "Jane Doe",
  "Senior Frontend Developer",
  "jane@example.test",
  "Summary:",
  "Experienced frontend engineer building reliable web applications with React and TypeScript.",
  "Experience",
  "Frontend Developer at Apex Soft",
  "January 2024 - Present",
  "Built accessible web applications and reusable interfaces.",
  "Education",
  "National University",
  "Bachelor 2015 2019",
  "Languages",
  "English - native",
  "Skills: React, TypeScript",
].join("\n");
const config = {
  get: (key: string) => (key === "CV_PARSE_OCR_LANGS" ? "eng" : undefined),
} as any;
const provider = new LocalCvParseProvider(config);
const knownSkills = [
  { name: "React", slug: "react" },
  { name: "TypeScript", slug: "typescript" },
];
const knownLanguages = [{ name: "English", code: "en", aliases: [] }];
function pdf(scanned = false): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 }),
      chunks: Buffer[] = [];
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    if (!scanned) doc.fontSize(13).text(cv);
    else {
      for (const [idx, text] of [
        cv.split("\n").slice(0, 6).join("\n"),
        cv.split("\n").slice(6).join("\n"),
      ].entries()) {
        if (idx) doc.addPage();
        doc.fontSize(8).text('Curriculum vitae - candidate attachment', 40, 20);
        const canvas = createCanvas(1600, 2200),
          ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 1600, 2200);
        ctx.fillStyle = "black";
        ctx.font = "32px Arial";
        text
          .split("\n")
          .forEach((line: string, i: number) =>
            ctx.fillText(line, 70, 100 + i * 65),
          );
        doc.image(canvas.toBuffer("image/png"), 0, 0, {
          width: 595,
          height: 842,
        });
      }
    }
    doc.end();
  });
}
async function main() {
  const pdfBuffer = await pdf();
  fs.writeFileSync(path.join(directory, "employee-cv.pdf"), pdfBuffer);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      cv
        .split("\n")
        .map((line) => "<w:p><w:r><w:t>" + line + "</w:t></w:r></w:p>")
        .join("") +
      "</w:body></w:document>",
  );
  const docx = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(path.join(directory, "employee-cv.docx"), docx);
  // Preserve the binary OLE/Word structure and fixed character offsets of the
  // licensed legacy fixture, replacing only equal-length UTF-16 text runs.
  const legacyCv = fs.readFileSync(path.resolve('scripts/fixtures/cv/word-extractor-sample.doc'));
  for (const [original, replacement] of [
    ['A second test of reviewing, but with Unicode characters in to see if character offsets get broken. 😀 ∀', 'Jane Doe\rFrontend Developer\rExperience\rFrontend Developer at Apex Soft\rJanuary 2024 - Present'],
    ['This is a test of reviewing', 'Skills: React, TypeScript'],
    ['This text has been inserted, ✻and should be included', 'Education\rNational University\rBachelor 2015 2019'],
  ]) {
    assert.ok(replacement.length <= original.length);
    const offset = legacyCv.indexOf(Buffer.from(original, 'utf16le'));
    assert.ok(offset >= 0, 'The legacy DOC source text must match the known fixture');
    Buffer.from(replacement.padEnd(original.length), 'utf16le').copy(legacyCv, offset);
  }
  fs.writeFileSync(path.join(directory, 'employee-cv.doc'), legacyCv);
  for (const [filename, buffer] of [
    ["cv.pdf", pdfBuffer],
    ["cv.docx", docx],
    ["cv.doc", legacyCv],
  ] as const) {
    const result = await provider.parse({
      filename,
      buffer,
      mimeType: "application/octet-stream",
      knownSkills,
      knownLanguages,
    });
    assert.ok(
      result.experiences.some(
        (e) =>
          /Frontend Developer/.test(e.title) &&
          /Apex Soft/.test(e.companyName) &&
          e.startDate === "2024-01-01",
      ),
    );
    assert.ok(result.skillNames.includes("React"));
    assert.ok(
      result.educations.some(
        (e) => e.degree === "BACHELOR" && e.endDate === "2019-01-01",
      ),
    );
    console.log(filename + ": file extraction + structured parse passed");
  }
  const legacy = await extractCvText(
    {
      filename: "cv.doc",
      buffer: fs.readFileSync(
        path.resolve("scripts/fixtures/cv/word-extractor-sample.doc"),
      ),
      mimeType: "application/msword",
    },
    config,
  );
  assert.ok(legacy.text.length > 20);
  assert.match(legacy.text, /test|document|sample|Hello/i);
  console.log("Legacy DOC: extracted readable fixture text");
  await assert.rejects(() =>
    extractCvText(
      {
        filename: "broken.docx",
        buffer: Buffer.from("broken"),
        mimeType: "application/octet-stream",
      },
      config,
    ),
  );
  console.log("Corrupt Word: rejected rather than empty success");
  const scanned = await pdf(true);
  fs.writeFileSync(path.join(directory, "employee-cv-scanned.pdf"), scanned);
  const result = await provider.parse({
    filename: "scanned.pdf",
    buffer: scanned,
    mimeType: "application/pdf",
    knownSkills,
    knownLanguages,
  });
  assert.equal(result.meta?.ocrUsed, true);
  assert.ok(
    result.experiences.some((e) => /Apex Soft/i.test(e.companyName)),
    "Experience on scanned page 2 must be read",
  );
  console.log("Scanned PDF: both pages read; page 2 experience parsed");
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
