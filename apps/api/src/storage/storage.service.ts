import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PUBLIC_OBJECT_PREFIX } from './public-prefix';

export { PUBLIC_OBJECT_PREFIX } from './public-prefix';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client;
  /** Signs browser-facing URLs against the public MinIO/S3 host (not Railway-internal). */
  private signerClient: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get('S3_BUCKET', 'job-talentio');
    this.publicUrl = this.config.get('S3_PUBLIC_URL', 'http://localhost:9000/job-talentio');
    const region = this.config.get('S3_REGION', 'us-east-1');
    const forcePathStyle = this.config.get('S3_FORCE_PATH_STYLE', 'true') === 'true';
    const credentials = {
      accessKeyId: this.config.get('S3_ACCESS_KEY', 'minioadmin'),
      secretAccessKey: this.config.get('S3_SECRET_KEY', 'minioadmin'),
    };
    this.client = new S3Client({
      region,
      endpoint: this.config.get('S3_ENDPOINT'),
      forcePathStyle,
      credentials,
    });
    const publicEndpoint = publicEndpointFromS3PublicUrl(this.publicUrl);
    this.signerClient = publicEndpoint
      ? new S3Client({
          region,
          endpoint: publicEndpoint,
          forcePathStyle,
          credentials,
        })
      : this.client;
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (err) {
        this.logger.warn(`Bucket ensure skipped: ${(err as Error).message}`);
      }
    }
    await this.ensurePublicReadPrefix();
  }

  /**
   * Allow anonymous GetObject for `public/*` so logos/avatars (and similar)
   * work from S3_PUBLIC_URL without signed URLs. Matches local docker `mc anonymous
   * set download …/public`. Private prefixes (cvs/) stay closed + presigned GET.
   */
  async ensurePublicReadPrefix(): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadPublicPrefix',
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/${PUBLIC_OBJECT_PREFIX}*`],
        },
      ],
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify(policy),
        }),
      );
      this.logger.log(`Bucket policy: anonymous GetObject on ${PUBLIC_OBJECT_PREFIX}*`);
    } catch (err) {
      this.logger.warn(
        `Could not set public read policy on ${PUBLIC_OBJECT_PREFIX}*: ${(err as Error).message}`,
      );
    }
  }

  /** Public base URL for objects (no trailing slash). */
  getPublicBaseUrl() {
    return this.publicUrl.replace(/\/$/, '');
  }

  publicUrlForKey(key: string) {
    return `${this.getPublicBaseUrl()}/${key.replace(/^\//, '')}`;
  }

  /** Idempotent put at a fixed key (demo logos, etc.). */
  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ key: string; url: string }> {
    const normalized = key.replace(/^\//, '');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: normalized,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { key: normalized, url: this.publicUrlForKey(normalized) };
  }

  async upload(
    buffer: Buffer,
    filename: string,
    contentType: string,
    folder = 'uploads',
  ): Promise<{ key: string; url: string }> {
    const key = `${folder}/${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return this.putObject(key, buffer, contentType);
  }

  async getPresignedPutUrl(key: string, contentType: string) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.signerClient, command, { expiresIn: 900 });
  }

  /** Time-limited download URL for private objects (CVs, etc.) — browser-reachable host. */
  async getPresignedGetUrl(key: string, expiresIn = 900) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.signerClient, command, { expiresIn });
  }

  /** Download object bytes for background workers (CV parse, etc.). */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const body = res.Body;
    if (!body) throw new Error(`Empty S3 body for ${key}`);
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /** Best-effort object removal (avatars, logos, purged CVs). */
  async delete(key: string | null | undefined): Promise<void> {
    const k = (key || '').trim();
    if (!k) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: k }));
    } catch (err) {
      this.logger.warn(`S3 delete skipped for ${k}: ${(err as Error).message}`);
    }
  }

  /** Extract object key from a public URL served by this bucket, if possible. */
  keyFromPublicUrl(url: string | null | undefined): string | null {
    const u = (url || '').trim();
    if (!u) return null;
    const base = this.publicUrl.replace(/\/$/, '');
    if (u.startsWith(`${base}/`)) return u.slice(base.length + 1);
    return null;
  }
}

/** Origin of S3_PUBLIC_URL for signing (strip trailing /bucket). */
function publicEndpointFromS3PublicUrl(publicUrl: string): string | null {
  try {
    const u = new URL(publicUrl);
    if (!u.host) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
