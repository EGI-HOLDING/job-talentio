import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ScreeningWorker } from './screening-worker.service';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(done: () => boolean) { const end = Date.now() + 800; while (!done() && Date.now() < end) await sleep(5); }
function fixture(count: number) {
  const rows = Array.from({ length: count }, (_, index) => ({ id: 'dispatch-' + index, kind: 'CV_SCORE', status: 'PENDING' }));
  const db: any = { aiScreeningWork: { findMany: async ({ where, take }: any) => where.kind.notIn ? [] : rows.filter(row => row.status === 'PENDING').slice(0, take) } };
  const worker = new ScreeningWorker(db, {} as any, {} as any, {} as any, {} as any, { expireAnswers: async () => {} } as any, {} as any, {} as any);
  return { rows, worker };
}
async function main() {
  const { rows, worker } = fixture(20);
  let running = 0, peak = 0, completed = 0;
  worker.process = async id => {
    const row = rows.find(row => row.id === id)!; assert.equal(row.status, 'PENDING'); row.status = 'RUNNING';
    peak = Math.max(peak, ++running); await sleep(10); row.status = 'DONE'; running--; completed++;
  };
  try {
    await Promise.all([worker.tick(), worker.tick()]);
    await waitFor(() => completed === rows.length);
    assert.equal(completed, 20, 'database fallback refills available capacity without waiting for the next three-second timer');
    assert.equal(peak, 2, 'refill preserves the concurrency limit');
  } finally { await worker.onModuleDestroy(); }

  const recovery = fixture(3); let attempts = 0, failures = 0;
  recovery.worker.process = async id => {
    const row = recovery.rows.find(row => row.id === id)!;
    attempts++; row.status = 'DONE';
    if (!failures++) throw Error('synthetic claim transport error');
    await sleep(5);
  };
  await recovery.worker.tick(); await waitFor(() => attempts === 3);
  assert.equal(attempts, 3, 'unexpected dispatch rejection is handled and remaining work can proceed');
  await recovery.worker.onModuleDestroy();

  const outage = fixture(4); let outageCalls = 0;
  outage.worker.process = async () => { outageCalls++; throw Error('synthetic database offline'); };
  await outage.worker.tick(); await sleep(50);
  assert.equal(outageCalls, 2, 'database failure waits for recovery timer instead of spinning immediate retries');
  await outage.worker.onModuleDestroy();

  const stopping = fixture(8); let started = 0;
  stopping.worker.process = async () => { started++; await sleep(25); };
  await stopping.worker.tick(); await stopping.worker.onModuleDestroy(); await sleep(50);
  assert.equal(started, 2, 'worker shutdown does not refill fallback dispatch');
  await stopping.worker.tick(); assert.equal(started, 2, 'stopped worker does not accept further timer ticks');
  console.log('Screening worker dispatch: immediate fallback refill, bounded concurrency, handled rejection and shutdown passed. Paid calls: 0.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
