import assert from "node:assert/strict";
import { CvParseService } from "./cv-parse.service";
import type { ParsedCvData } from "./cv-parser";
import { mock } from 'node:test';
import { CV_PARSE_TIMEOUT_MS } from './cv-parse.service';
import type { CvParseProviderInput } from './parse/cv-parse.types';
const valid: ParsedCvData = {
  headline: "Frontend Developer",
  textPreview: "Known CV text",
  skillNames: ["React"],
  experiences: [],
  educations: [],
  languages: [],
};
function fixture(parse: (input: CvParseProviderInput) => Promise<ParsedCvData> = async () => valid, storageError?: Error) {
  let row: any = {
    id: "resume",
    fileKey: "cv.pdf",
    deletedAt: null,
    parseGeneration: 1,
    parseStatus: "PENDING",
    updatedAt: new Date(),
  };
  let reads = 0;
  const db: any = {
    resume: {
      findUnique: async () => ({ ...row }),
      update: async ({ data }: any) => {
        row = {
          ...row,
          ...data,
          parseGeneration:
            row.parseGeneration + (data.parseGeneration?.increment || 0),
        };
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const matches = Object.entries(where).every(([k, v]: any) =>
          typeof v === "object" && v !== null && "in" in v
            ? v.in.includes(row[k])
            : row[k] === v,
        );
        if (!matches) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    skill: { findMany: async (query: any) => {
      assert.equal(query.take, undefined, 'Parser catalog must not have an arbitrary row cap');
      return Array.from({ length: 601 }, (_, i) => ({ name: `Catalog skill ${i}`, slug: `catalog-${i}`, aliases: [] }));
    } },
    language: { findMany: async () => [] },
  };
  const service = new CvParseService(
    db,
    {
      getObjectBuffer: async () => {
        reads++;
        if (storageError) throw storageError;
        return Buffer.from("file");
      },
    } as any,
    { name: "fake", parse } as any,
  );
  return {
    service,
    get row() {
      return row;
    },
    replace: () => {
      row = {
        ...row,
        fileKey: "new.pdf",
        parseGeneration: row.parseGeneration + 1,
        parseStatus: "PENDING",
      };
    },
    remove: () => { row = { ...row, deletedAt: new Date(), parseGeneration: row.parseGeneration + 1, parseStatus: 'NONE' }; },
    get reads() {
      return reads;
    },
  };
}
async function main() {
  const normal = fixture();
  await Promise.all([
    normal.service.processResume("resume", 1),
    normal.service.processResume("resume", 1),
  ]);
  assert.equal(normal.reads, 1);
  assert.equal(normal.row.parseStatus, "READY");
  const catalog = fixture(async input => { assert.equal(input.knownSkills.length, 601); return valid; });
  await catalog.service.processResume('resume', 1);
  const busy = fixture();
  (busy.service as any).activeParses = 2;
  await busy.service.processResume('resume', 1);
  assert.equal(busy.reads, 0);
  assert.equal(busy.row.parseStatus, 'PENDING', 'Capacity overflow remains durable work for the recovery sweep');
  const storageFailed = fixture(undefined, new Error('Storage unavailable'));
  await assert.rejects(storageFailed.service.processResume('resume', 1), /Storage unavailable/);
  assert.equal(storageFailed.row.parseStatus, 'FAILED');
  assert.equal(storageFailed.row.fileKey, 'cv.pdf');
  let resolve!: (v: ParsedCvData) => void;
  const stale = fixture(() => new Promise((r) => (resolve = r)));
  const work = stale.service.processResume("resume", 1);
  while (!resolve) await new Promise((r) => setImmediate(r));
  stale.replace();
  resolve(valid);
  await work;
  assert.equal(stale.row.parseStatus, "PENDING");
  assert.equal(stale.row.parsedData, undefined);
  let finishRemoved!: (result: ParsedCvData) => void;
  const removed = fixture(() => new Promise(resolve => { finishRemoved = resolve; }));
  const beforeDelete = removed.service.processResume('resume', 1);
  while (!finishRemoved) await new Promise(resolve => setImmediate(resolve));
  removed.remove(); finishRemoved(valid); await beforeDelete;
  assert.equal(removed.row.parseStatus, 'NONE', 'A parse that finishes after deletion cannot revive its CV');
  const failed = fixture(async () => {
    throw Error("provider failed");
  });
  await assert.rejects(
    () => failed.service.processResume("resume", 1),
    /provider failed/,
  );
  assert.equal(failed.row.parseStatus, "FAILED");
  assert.equal(failed.row.fileKey, "cv.pdf");
  const empty = fixture(async () => ({
    ...valid,
    headline: undefined,
    skillNames: [],
  }));
  await assert.rejects(
    () => empty.service.processResume("resume", 1),
    /No readable/,
  );
  assert.equal(empty.row.parseStatus, "FAILED");
  const offline = fixture();
  offline.service.setQueue({
    add: async () => {
      throw Error("Redis offline");
    },
  } as any);
  await offline.service.enqueue("resume");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(offline.row.parseStatus, "READY");
  const hanging = fixture();
  hanging.service.setQueue({ add: () => new Promise(() => {}) } as any);
  const start = Date.now();
  await hanging.service.enqueue("resume");
  assert.ok(Date.now() - start < 5000);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(hanging.row.parseStatus, "READY");
  const oldFailure = fixture(async () => {
    await new Promise((r) => setTimeout(r, 20));
    throw Error("old failure");
  });
  const fail = oldFailure.service.processResume("resume", 1);
  await new Promise((r) => setTimeout(r, 5));
  oldFailure.replace();
  await assert.rejects(() => fail);
  assert.equal(oldFailure.row.parseStatus, "PENDING");
  let finishLate!: (result: ParsedCvData) => void;
  const timedOut = fixture(() => new Promise(resolve => { finishLate = resolve; }));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const parsing = timedOut.service.processResume('resume', 1);
    while (!finishLate) await new Promise(resolve => setImmediate(resolve));
    const rejected = assert.rejects(parsing, /timed out/);
    mock.timers.tick(CV_PARSE_TIMEOUT_MS + 1);
    await rejected;
    assert.equal(timedOut.row.parseStatus, 'FAILED');
    finishLate(valid);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timedOut.row.parseStatus, 'FAILED', 'late provider result cannot overwrite a timeout');
  } finally { mock.timers.reset(); }
  console.log(
    "CV queue: duplicate claim, stale success/failure, provider/empty failure, offline/hanging Redis passed",
  );
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
