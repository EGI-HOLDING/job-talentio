import { BadRequestException } from '@nestjs/common';

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, { contentType: string; signature: (buffer: Buffer) => boolean }> = {
  '.pdf': { contentType: 'application/pdf', signature: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
  '.doc': {
    contentType: 'application/msword',
    signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  },
  '.docx': {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
};

export type OfferUploadFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export type ValidatedOfferFile = {
  buffer: Buffer;
  originalName: string;
  contentType: string;
  sizeBytes: number;
};

export function sanitizeOfferFilename(value: string): string {
  const normalized = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  const parts = normalized.split('.');
  const extension = parts.length > 1 ? '.' + parts.pop()!.toLowerCase() : '';
  const base = parts.join('.').replace(/\s+/g, ' ').trim().slice(0, 240).replace(/[. ]+$/g, '');
  const result = (base || 'document') + extension;
  return Array.from(result).slice(0, 255).join('');
}

export function validateOfferFiles(files: OfferUploadFile[] = []): ValidatedOfferFile[] {
  if (!Array.isArray(files) || files.length > MAX_FILES) {
    throw new BadRequestException('Choose no more than 5 documents');
  }
  return files.map((file) => {
    const originalName = sanitizeOfferFilename(file.originalname || '');
    const extension = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
    const type = TYPES[extension];
    if (!type || file.mimetype !== type.contentType) {
      throw new BadRequestException('Only PDF, DOC, and DOCX documents are allowed');
    }
    if (!Buffer.isBuffer(file.buffer) || !file.size || file.size > MAX_BYTES || file.buffer.length !== file.size) {
      throw new BadRequestException('Each document must be no larger than 5 MB');
    }
    if (!type.signature(file.buffer)) {
      throw new BadRequestException('The document content does not match its file type');
    }
    return { buffer: file.buffer, originalName, contentType: type.contentType, sizeBytes: file.size };
  });
}

export const OFFER_DOCUMENT_LIMITS = { maxFiles: MAX_FILES, maxBytes: MAX_BYTES } as const;
