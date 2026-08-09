import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import type { DemoLogoUploader } from './company-logo-backfill';

/** Standalone MinIO/S3 helper for prisma seed (no Nest DI). */
export function createDemoLogoUploaderFromEnv(): DemoLogoUploader {
  const bucket = process.env.S3_BUCKET || 'job-talentio';
  const publicUrl = (process.env.S3_PUBLIC_URL || 'http://localhost:9000/job-talentio').replace(
    /\/$/,
    '',
  );
  const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });

  let bucketReady: Promise<void> | null = null;
  async function ensureBucket() {
    if (!bucketReady) {
      bucketReady = (async () => {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }));
        } catch {
          try {
            await client.send(new CreateBucketCommand({ Bucket: bucket }));
          } catch {
            /* ignore */
          }
        }
      })();
    }
    await bucketReady;
  }

  return {
    publicUrlForKey(key: string) {
      return `${publicUrl}/${key.replace(/^\//, '')}`;
    },
    async putObject(key: string, buffer: Buffer, contentType: string) {
      const normalized = key.replace(/^\//, '');
      await ensureBucket();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: normalized,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      return { key: normalized, url: `${publicUrl}/${normalized}` };
    },
  };
}
