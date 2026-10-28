import { inflateRawSync } from 'node:zlib';

const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_ENTRY = 16 * 1024 * 1024;
/** Check both declared and actual inflated sizes before handing a DOCX to
 * mammoth/JSZip, which otherwise inflates entries without an output limit. */
export function validateCvDocxArchive(buffer: Buffer) {
  const invalid = () => new Error('Invalid or oversized DOCX archive');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw invalid();
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (!count || count > 2000 || start + size !== end || buffer.readUInt16LE(end + 8) !== count) throw invalid();
  let cursor = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20), uncompressed = buffer.readUInt32LE(cursor + 24);
    const name = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    if ((flags & 1) || ![0, 8].includes(method) || uncompressed > MAX_ENTRY || total + uncompressed > MAX_TOTAL || local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50) throw invalid();
    const data = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (data + compressed > start) throw invalid();
    const source = buffer.subarray(data, data + compressed);
    const inflated = method === 0 ? source : inflateRawSync(source, { maxOutputLength: Math.min(MAX_ENTRY, MAX_TOTAL - total) });
    if (inflated.length !== uncompressed) throw invalid();
    total += inflated.length;
    cursor += 46 + name + extra + comment;
    if (cursor > end) throw invalid();
  }
  if (cursor !== end) throw invalid();
}
