import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Shared Multer limits for CV / resume uploads. */
export const resumeUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new BadRequestException('Only PDF or Word documents are allowed') as never, false);
      return;
    }
    cb(null, true);
  },
};

/** Avatars and company logos (cropped client-side before upload). */
export const imageUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      cb(new BadRequestException('Only JPEG, PNG, or WebP images are allowed') as never, false);
      return;
    }
    cb(null, true);
  },
};
