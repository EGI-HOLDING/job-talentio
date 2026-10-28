import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

@Injectable()
export class OperationsService {
  constructor(private db: PrismaService) {}

  private identity(scope: string, key: string | undefined, input: unknown) {
    if (!key || !/^[a-zA-Z0-9:_-]{8,120}$/.test(key))
      throw new BadRequestException('A valid Idempotency-Key is required');
    return {
      scope,
      key,
      payloadHash: createHash('sha256')
        .update(JSON.stringify(canonical(input)))
        .digest('hex'),
    };
  }

  async transaction<T>(
    scope: string,
    key: string | undefined,
    input: unknown,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const identity = this.identity(scope, key, input);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${scope + ':' + identity.key}, 0))`,
        );
        const existing = await tx.operationKey.findUnique({
          where: { scope_key: { scope, key: identity.key } },
        });
        if (existing) {
          if (existing.payloadHash !== identity.payloadHash)
            throw new ConflictException('Idempotency key was used with different input');
          if (existing.state !== 'DONE') throw new ConflictException('Operation needs review');
          return { value: existing.result as T, replayed: true };
        }
        const value = await run(tx);
        await tx.operationKey.create({
          data: {
            ...identity,
            state: 'DONE',
            result: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue,
          },
        });
        return { value, replayed: false };
      },
      { maxWait: 15000, timeout: 30000 },
    );
  }

  /** External effects must never be repeated after an ambiguous failure. */
  async external<T>(
    scope: string,
    key: string | undefined,
    input: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const identity = this.identity(scope, key, input);
    const claimed = await this.db.operationKey.createMany({
      data: [identity],
      skipDuplicates: true,
    });
    if (!claimed.count) {
      const existing = await this.db.operationKey.findUniqueOrThrow({
        where: { scope_key: { scope, key: identity.key } },
      });
      if (existing.payloadHash !== identity.payloadHash)
        throw new ConflictException('Idempotency key was used with different input');
      if (existing.state !== 'DONE')
        throw new ConflictException(
          'Operation is in progress or needs review; do not send it again',
        );
      return existing.result as T;
    }
    try {
      const value = await run();
      await this.db.operationKey.update({
        where: { scope_key: { scope, key: identity.key } },
        data: { state: 'DONE', result: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue },
      });
      return value;
    } catch (error) {
      await this.db.operationKey.update({
        where: { scope_key: { scope, key: identity.key } },
        data: { state: 'REVIEW' },
      });
      throw error;
    }
  }
}
