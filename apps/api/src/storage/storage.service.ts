import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get('S3_BUCKET', 'job-talentio');
    this.publicUrl = this.config.get('S3_PUBLIC_URL', 'http://localhost:9000/job-talentio');
    this.client = new S3Client({
      region: this.config.get('S3_REGION', 'us-east-1'),
      endpoint: this.config.get('S3_ENDPOINT'),
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', 'true') === 'true',
      credentials: {
        accessKeyId: this.config.get('S3_ACCESS_KEY', 'minioadmin'),
        secretAccessKey: this.config.get('S3_SECRET_KEY', 'minioadmin'),
      },
    });
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
  }

  async upload(
    buffer: Buffer,
    filename: string,
    contentType: string,
    folder = 'uploads',
  ): Promise<{ key: string; url: string }> {
    const key = `${folder}/${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { key, url: `${this.publicUrl}/${key}` };
  }

  async getPresignedPutUrl(key: string, contentType: string) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  /** Time-limited download URL for private objects (CVs, etc.) */
  async getPresignedGetUrl(key: string, expiresIn = 900) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
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
