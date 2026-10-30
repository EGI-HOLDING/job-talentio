import type { JobPlacement } from '@job-talentio/shared';
import type { EmployeeEvaluation, EmployeeMatchJob } from './employee-matching';

/** Compose before pagination. Never change evidence, scores, or organic relative order. */
export function placeEmployeeBoosts<T extends { job: EmployeeMatchJob; evaluation: EmployeeEvaluation }>(
  organic: readonly T[], activeBoostIds: ReadonlySet<string>,
): Array<T & { placement: JobPlacement }> {
  type Queue = { company: string; indices: number[]; offset: number };
  const groups = new Map<string, Queue>();
  organic.forEach((row, index) => {
    if (!activeBoostIds.has(row.job.id) || !row.evaluation.positiveCore
      || row.evaluation.insights.evidence.some(e => e.required && e.status === 'UNMET')) return;
    const queue = groups.get(row.job.companyId) ?? { company: row.job.companyId, indices: [], offset: 0 };
    queue.indices.push(index); groups.set(queue.company, queue);
  });
  // One heap entry per company: avoid quadratic scans when many boosts belong
  // to the same employer, while retaining the original relevance ordering.
  const heap: Queue[] = [];
  const key = (q: Queue) => q.indices[q.offset];
  const push = (q: Queue) => {
    let i = heap.length; heap.push(q);
    while (i > 0) { const parent = (i-1) >> 1; if (key(heap[parent]) <= key(q)) break; heap[i]=heap[parent]; i=parent; }
    heap[i]=q;
  };
  const pop = () => {
    const first=heap[0], last=heap.pop()!;
    if (heap.length) {
      let i=0;
      while (i*2+1 < heap.length) {
        let child=i*2+1;
        if (child+1 < heap.length && key(heap[child+1]) < key(heap[child])) child++;
        if (key(last) <= key(heap[child])) break;
        heap[i]=heap[child]; i=child;
      }
      heap[i]=last;
    }
    return first;
  };
  groups.forEach(push);
  const emitted = new Set<string>();
  const result: Array<T & { placement: JobPlacement }> = [];
  let cursor = 0, previousBoostCompany = '';
  while (result.length < organic.length) {
    while (emitted.has(organic[cursor]?.job.id)) cursor++;
    const next = organic[cursor];
    const slot = result.length >= 2 && (result.length - 2) % 6 === 0;
    let promoted: T | undefined;
    if (slot) {
      let held: Queue | undefined;
      while (heap.length) {
        const queue=pop();
        while (queue.offset < queue.indices.length && emitted.has(organic[key(queue)].job.id)) queue.offset++;
        if (queue.offset === queue.indices.length) continue;
        if (queue.company === previousBoostCompany) { held=queue; continue; }
        // Reinsert after lazy cleanup so another company's earlier candidate wins.
        if (heap.length && key(heap[0]) < key(queue)) { push(queue); continue; }
        const candidate=organic[key(queue)];
        push(queue);
        if (candidate.job.id !== next.job.id) promoted=candidate;
        break;
      }
      if (held) push(held);
    }
    const row = promoted ?? next;
    emitted.add(row.job.id);
    if (promoted) previousBoostCompany = row.job.companyId;
    result.push({ ...row, placement: promoted ? 'BOOST' : 'ORGANIC' });
  }
  return result;
}
