import assert from 'node:assert/strict';
import { validateOfferFiles, OFFER_DOCUMENT_LIMITS, sanitizeOfferFilename } from './application-offer-files';
import { bulkCampaignSchema, offerDecisionSchema } from '@job-talentio/shared';

const pdf = (name = 'offer.pdf') => ({
  originalname: name,
  mimetype: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7\nTalentio offer'),
  size: Buffer.byteLength('%PDF-1.7\nTalentio offer'),
});
const doc = () => ({
  originalname: 'legacy.doc',
  mimetype: 'application/msword',
  buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]),
  size: 9,
});
const docx = () => ({
  originalname: 'modern.docx',
  mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
  size: 6,
});
function rejects(files: Parameters<typeof validateOfferFiles>[0]) {
  assert.throws(() => validateOfferFiles(files));
}

assert.deepEqual(OFFER_DOCUMENT_LIMITS, { maxFiles: 5, maxBytes: 5 * 1024 * 1024 });
assert.equal(validateOfferFiles([]).length, 0);
assert.equal(validateOfferFiles([pdf(), doc(), docx()]).length, 3);
assert.equal(validateOfferFiles([pdf('1.pdf'), pdf('2.pdf'), pdf('3.pdf'), pdf('4.pdf'), pdf('5.pdf')]).length, 5);
rejects(Array.from({ length: 6 }, (_, index) => pdf(index + '.pdf')));
rejects([{ ...pdf(), originalname: 'offer.exe' }]);
rejects([{ ...pdf(), mimetype: 'application/msword' }]);
rejects([{ ...pdf(), buffer: Buffer.from('not a pdf'), size: 10 }]);
rejects([{ ...pdf(), size: 0 }]);
rejects([{ ...pdf(), buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x41), size: 5 * 1024 * 1024 + 1 }]);
assert.equal(sanitizeOfferFilename('../../offer final.pdf'), '.._.._offer final.pdf');

const base = { companyId: 'company', jobPostId: 'job', applicationIds: ['app'] };
assert.equal(bulkCampaignSchema.safeParse({ ...base, toStatus: 'OFFER' }).success, false);
assert.equal(bulkCampaignSchema.safeParse({ ...base, toStatus: 'HIRED' }).success, true);
assert.equal(offerDecisionSchema.safeParse({ decision: 'ACCEPT' }).success, true);
assert.equal(offerDecisionSchema.safeParse({ decision: 'WITHDRAW' }).success, false);

console.log('application offer file validation: smoke ok');
