import { bucketByDay, buildFunnel, conversion, groupSources, summarizeResponseTimes } from './job-stats';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function funnelCountsLaterStagesIntoEarlierOnes() {
  const funnel = buildFunnel(120, { NEW: 5, IN_REVIEW: 3, INTERVIEW: 2, OFFER: 1, HIRED: 1, REJECTED: 4 });
  assert(funnel.views === 120, 'views pass through');
  assert(funnel.applications === 16, `applications ${funnel.applications}`);
  assert(funnel.inReview === 7, `inReview ${funnel.inReview}`);
  assert(funnel.interview === 4, `interview ${funnel.interview}`);
  assert(funnel.offer === 2, `offer ${funnel.offer}`);
  assert(funnel.hired === 1, `hired ${funnel.hired}`);
  assert(funnel.rejected === 4, 'rejected reported separately');
}

function sourcesMergeDirectAndSort() {
  const sources = groupSources([
    { source: null, count: 3 },
    { source: '', count: 2 },
    { source: 'telegram:channel', count: 7 },
    { source: 'pwa', count: 1 },
  ]);
  assert(sources[0].source === 'telegram:channel' && sources[0].count === 7, 'largest source first');
  assert(sources.find((s) => s.source === 'direct')?.count === 5, 'null and empty fold into direct');
}

function responseTimesMedianAndSla() {
  const now = new Date('2026-09-18T12:00:00Z');
  const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
  const summary = summarizeResponseTimes(
    [
      { createdAt: h(10), status: 'IN_REVIEW', firstResponseAt: h(8) }, // 2h
      { createdAt: h(30), status: 'INTERVIEW', firstResponseAt: h(20) }, // 10h
      { createdAt: h(50), status: 'REJECTED', firstResponseAt: h(44) }, // 6h
      { createdAt: h(72), status: 'NEW', firstResponseAt: null }, // waiting > 48h
      { createdAt: h(5), status: 'NEW', firstResponseAt: null }, // waiting, inside SLA
    ],
    now,
  );
  assert(summary.medianHours === 6, `median ${summary.medianHours}`);
  assert(summary.answered === 3, 'three answered');
  assert(summary.waitingOverSla === 1, `waiting over SLA ${summary.waitingOverSla}`);
  assert(summarizeResponseTimes([], now).medianHours === null, 'no data -> null median');
}

function dailyBucketsAreZeroFilledAndOrdered() {
  const now = new Date('2026-09-18T15:00:00Z');
  const points = bucketByDay(
    [new Date('2026-09-18T01:00:00Z'), new Date('2026-09-17T23:00:00Z'), new Date('2026-09-01T00:00:00Z')],
    3,
    now,
  );
  assert(points.length === 3, 'one point per day');
  assert(points[0].day === '2026-09-16' && points[2].day === '2026-09-18', 'oldest first');
  assert(points[1].count === 1 && points[2].count === 1 && points[0].count === 0, 'counts land on the right day');
}

function conversionRounds() {
  assert(conversion(1, 3) === 33.3, `conversion ${conversion(1, 3)}`);
  assert(conversion(2, 0) === 0, 'empty base');
}

funnelCountsLaterStagesIntoEarlierOnes();
sourcesMergeDirectAndSort();
responseTimesMedianAndSla();
dailyBucketsAreZeroFilledAndOrdered();
conversionRounds();
console.log('api: job-stats smoke ok');
