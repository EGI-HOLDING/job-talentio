import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import type { DemoLogoUploader } from './company-logo-backfill';
import { PUBLIC_OBJECT_PREFIX } from '../storage/public-prefix';

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
        try {
          await client.send(
            new PutBucketPolicyCommand({
              Bucket: bucket,
              Policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                  {
                    Sid: 'PublicReadPublicPrefix',
                    Effect: 'Allow',
                    Principal: { AWS: ['*'] },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${bucket}/${PUBLIC_OBJECT_PREFIX}*`],
                  },
                ],
              }),
            }),
          );
        } catch {
          /* local mc anonymous may already cover this */
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
