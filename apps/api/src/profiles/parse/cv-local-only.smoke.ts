import assert from "node:assert/strict";
import { ConfigService } from "@nestjs/config";
import http from "node:http";
import https from "node:https";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCvParseProvider } from "./cv-parse.factory";
import { LocalCvParseProvider } from "./providers/local-cv-parse.provider";

const apiRequire = createRequire(__filename);
const JSZip = createRequire(apiRequire.resolve("mammoth"))("jszip");

async function main() {
  // Guard the production parsing sources as well as the runtime behavior below.
  function checkSources(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) checkSources(filename);
      else if (filename.endsWith(".ts") && !filename.endsWith(".smoke.ts")) {
        assert.doesNotMatch(
          readFileSync(filename, "utf8"),
          /createOpenAiClient|OpenAiClient|api\.openai\.com|chatJson|LLM_CV_SYSTEM_PROMPT/,
          filename,
        );
      }
    }
  }
  checkSources(__dirname);
  assert.equal(
    readdirSync(join(__dirname, "providers"))
      .filter((f) => f.endsWith(".ts"))
      .join(","),
    "local-cv-parse.provider.ts",
  );

  const text =
    "Jane Doe\nFrontend Developer\nExperience\nFrontend Developer at Apex Soft\nJanuary 2024 - Present\nSkills: React";
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      text
        .split("\n")
        .map((line) => "<w:p><w:r><w:t>" + line + "</w:t></w:r></w:p>")
        .join("") +
      "</w:body></w:document>",
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const original = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };
  let networkCalls = 0;
  const blockNetwork = () => {
    networkCalls++;
    throw new Error("CV parsing attempted an outbound API request");
  };
  globalThis.fetch = blockNetwork as any;
  http.request = blockNetwork as any;
  http.get = blockNetwork as any;
  https.request = blockNetwork as any;
  https.get = blockNetwork as any;
  syncBuiltinESMExports();
  try {
    for (const legacyProvider of [
      undefined,
      "local",
      "llm",
      "affinda",
      "openai",
      "gpt",
      " LLM ",
      "unknown",
    ]) {
      const config = new ConfigService({
        CV_PARSE_PROVIDER: legacyProvider,
        OPENAI_API_KEY: "dummy-key-must-never-be-used",
        OPENAI_MODEL: "gpt-4o-mini",
        CV_PARSE_OCR: false,
      });
      const get = config.get.bind(config);
      config.get = ((key: string, ...args: any[]) => {
        assert.ok(
          !key.startsWith("OPENAI_"),
          "CV parsing must never read OpenAI credentials/settings",
        );
        return (get as any)(key, ...args);
      }) as any;
      const provider = createCvParseProvider(config);
      assert.ok(provider instanceof LocalCvParseProvider);
      assert.equal(provider.name, "local");
      const input = {
        buffer,
        filename: "cv.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        knownSkills: [{ name: "React", slug: "react" }],
        knownLanguages: [],
      };
      const result = await provider.parse(input);
      assert.deepEqual(result.meta, {
        provider: "local",
        ocrUsed: false,
        llmUsed: false,
      });
      assert.ok(result.experiences.some((e) => e.companyName === "Apex Soft"));
      assert.ok(result.skillNames.includes("React"));
      await assert.rejects(
        provider.parse({ ...input, buffer: Buffer.from("corrupt DOCX") }),
      );
      await assert.rejects(
        provider.parse({
          ...input,
          filename: "cv.txt",
          mimeType: "text/plain",
        }),
        /supports PDF, DOCX and DOC/,
      );
    }
    assert.equal(
      networkCalls,
      0,
      "Success and failure must never call a paid API",
    );
  } finally {
    globalThis.fetch = original.fetch;
    http.request = original.httpRequest;
    http.get = original.httpGet;
    https.request = original.httpsRequest;
    https.get = original.httpsGet;
    syncBuiltinESMExports();
  }
  console.log(
    "CV local-only: legacy provider overrides ignored, OpenAI settings unread, zero HTTP calls on success/failure",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
