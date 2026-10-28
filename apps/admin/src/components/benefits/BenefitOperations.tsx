'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { postOnce } from '@/lib/operations';
export function BenefitOperations() {
  const [health, setHealth] = useState<any>(null),
    [exposure, setExposure] = useState<any>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api('/admin/benefits/health'), api<any>('/admin/benefits/exposure-policy')])
        .then(([health, policy]) => {
          if (alive) {
            setHealth(health);
            setExposure(policy.payload);
          }
        })
        .catch((error) => {
          if (alive) setMessage(error.message);
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>, kind: 'exposure' | 'promotion') {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const reason = String(form.get('reason'));
      if (kind === 'promotion') {
        await postOnce(
          '/admin/benefits/jobs/' + encodeURIComponent(String(form.get('jobId'))) + '/adjustments',
          {
            boostDays: Number(form.get('boostDays')),
            featuredDays: Number(form.get('featuredDays')),
            reason,
          },
        );
      } else {
        const row = await api<any>('/admin/benefits/exposure-policy', {
          method: 'POST',
          body: JSON.stringify({
            halfLifeDays: Number(form.get('halfLifeDays')),
            cap: Number(form.get('cap')),
            boostAmplitude: Number(form.get('boostAmplitude')),
            reason,
          }),
        });
        setExposure(row.payload);
      }
      setMessage('Saved with audit history');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  const reason = (
    <label>
      Reason
      <input name="reason" required minLength={8} maxLength={1000} />
    </label>
  );
  return (
    <>
      <section className="panel" style={{ padding: 24, marginTop: 16 }}>
        <h2>Exposure policy</h2>
        {exposure && (
          <form
            key={exposure.version}
            onSubmit={(event) => void submit(event, 'exposure')}
            style={{ display: 'grid', gap: 12, maxWidth: 600 }}
          >
            <p>
              Current version: {exposure.version}. These settings apply equally to every profession
              and language; text relevance is evaluated first.
            </p>
            <label>
              Freshness half-life, days
              <input
                name="halfLifeDays"
                type="number"
                min={1}
                max={365}
                defaultValue={exposure.halfLifeDays}
                required
              />
            </label>
            <label>
              Maximum exposure multiplier
              <input
                name="cap"
                type="number"
                step="0.05"
                min={1}
                max={3}
                defaultValue={exposure.cap}
                required
              />
            </label>
            <label>
              Boost amplitude
              <input
                name="boostAmplitude"
                type="number"
                step="0.05"
                min={0}
                max={1}
                defaultValue={exposure.boostAmplitude}
                required
              />
            </label>
            {reason}
            <button className="primary" disabled={busy}>
              Save new exposure version
            </button>
          </form>
        )}
      </section>
      <section className="panel" style={{ padding: 24, marginTop: 16 }}>
        <h2>Promotion correction</h2>
        <p>Reserved boost and elapsed featured time cannot be removed.</p>
        <form
          onSubmit={(event) => void submit(event, 'promotion')}
          style={{ display: 'grid', gap: 12, maxWidth: 600 }}
        >
          <label>
            Job ID
            <input name="jobId" required />
          </label>
          <label>
            Boost days to add or subtract
            <input type="number" name="boostDays" defaultValue={0} min={-30} max={30} required />
          </label>
          <label>
            Featured days to add or subtract
            <input
              type="number"
              name="featuredDays"
              defaultValue={0}
              min={-365}
              max={365}
              required
            />
          </label>
          {reason}
          <button className="primary" disabled={busy}>
            Apply correction
          </button>
        </form>
      </section>
      <section className="panel" style={{ padding: 24, marginTop: 16 }}>
        <h2>Operational monitoring</h2>
        {health && (
          <dl>
            <dt>Expired jobs awaiting worker</dt>
            <dd>{health.expiryBacklog}</dd>
            <dt>Operations requiring manual review</dt>
            <dd>{health.operationsNeedingReview}</dd>
            <dt>Oldest unfinished operation</dt>
            <dd>{health.oldestRunning?.createdAt || '-'}</dd>
            <dt>Search projection failures since restart</dt>
            <dd>{health.index.syncFailures || 0}</dd>
            <dt>Last accepted indexing request</dt>
            <dd>{health.index.lastEnqueuedAt || '-'}</dd>
          </dl>
        )}
      </section>
      {message && <p role="status">{message}</p>}
    </>
  );
}
