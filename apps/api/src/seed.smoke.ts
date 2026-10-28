import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { SeedService } from './seed.service';
import { PrismaService } from './prisma/prisma.service';

async function main() {
  for (const role of ['EMPLOYEE', 'RECRUITER', 'SUPER_ADMIN']) {
    let changes = 0;
    const prisma = { user: {
      findUnique: async () => ({ id: 'existing-account', role }),
      update: async () => { changes += 1; },
      create: async () => { changes += 1; },
    } } as unknown as PrismaService;
    const service = new SeedService(prisma, new ConfigService({ SUPERADMIN_PASSWORD: 'long-enough-bootstrap-password' }));
    await service.onModuleInit();
    assert.equal(changes, 0, `startup must never change an existing ${role} account`);
  }
  let created = 0;
  const prisma = { user: {
    findUnique: async () => null,
    create: async ({ data }: { data: { role: string; passwordHash: string } }) => {
      assert.equal(data.role, 'SUPER_ADMIN');
      assert.ok(data.passwordHash.startsWith('$2'));
      created += 1;
    },
  } } as unknown as PrismaService;
  await new SeedService(prisma, new ConfigService({})).onModuleInit();
  assert.equal(created, 0, 'missing password must not bootstrap an admin');
  await new SeedService(prisma, new ConfigService({ SUPERADMIN_PASSWORD: 'long-enough-bootstrap-password' })).onModuleInit();
  assert.equal(created, 1, 'valid bootstrap configuration creates the initial admin');
  console.log('api: admin bootstrap smoke ok');
}
void main();
