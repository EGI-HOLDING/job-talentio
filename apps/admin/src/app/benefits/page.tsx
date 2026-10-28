'use client';
import { BenefitOperations } from '@/components/benefits/BenefitOperations';
import { useEffect, useState } from 'react';
import { api, apiPatch } from '@/lib/api';
import { PageHeader } from '@/components/shell/PageHeader';
export default function BenefitsPage() {
  const [policies, setPolicies] = useState<any[]>([]),
    [code, setCode] = useState('STANDARD'),
    [settings, setSettings] = useState(''),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [flags, setFlags] = useState<any[]>([]),
    [companyId, setCompanyId] = useState(''),
    [history, setHistory] = useState<any>(null),
    [page, setPage] = useState(1);
  const load = async () => {
    const [policies, flags] = await Promise.all([
      api<any[]>('/admin/benefits/policies'),
      api<any[]>('/admin/flags'),
    ]);
    setPolicies(policies);
    setFlags(flags);
  };
  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
  }, []);
  useEffect(() => {
    const policy = policies.find((row) => row.code === code);
    if (policy) setSettings(JSON.stringify(policy.settings, null, 2));
  }, [code, policies]);
  async function perform(run: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await run();
      await load();
      setMessage('Saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  async function ledger(next = 1) {
    setPage(next);
    setHistory(
      await api(
        '/admin/benefits/companies/' + encodeURIComponent(companyId) + '/history?page=' + next,
      ),
    );
  }
  return (
    <>
      <PageHeader
        title="HR benefits"
        subtitle="Versioned policies, manual grants and promotion history. No payment processing."
      />
      <section className="panel" style={{ padding: 24 }}>
        <h2>Rollout</h2>
        <p>
          Initialize once to give existing active jobs a 30-day Free transition period. This
          preserves their original ranking age. Enable packages after initialization, then
          promotions, analytics and support in stages.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void perform(() =>
              api('/admin/benefits/rollout', {
                method: 'POST',
                headers: { 'Idempotency-Key': 'initial-hr-rollout-v1' },
                body: '{}',
              }),
            )
          }
        >
          Initialize transition
        </button>
        <div style={{ display: 'flex', gap: 20, marginBlock: 16 }}>
          {['hr_packages', 'hr_promotions', 'hr_analytics', 'hr_support'].map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                disabled={busy}
                checked={flags.find((flag) => flag.key === key)?.enabled || false}
                onChange={(event) =>
                  void perform(() =>
                    api('/admin/flags', {
                      method: 'POST',
                      body: JSON.stringify({ key, enabled: event.target.checked }),
                    }),
                  )
                }
              />
              {key}
            </label>
          ))}
        </div>
      </section>
      <section className="panel" style={{ padding: 24, marginTop: 16 }}>
        <h2>New policy version</h2>
        <p>
          Existing job grants keep their policy snapshot. A new version applies to subsequent
          grants. Per-job packages are assigned from the Jobs table.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(() =>
              api('/admin/benefits/policies', {
                method: 'POST',
                body: JSON.stringify({ code, settings: JSON.parse(settings), reason }),
              }),
            );
          }}
          style={{ display: 'grid', gap: 12, maxWidth: 700 }}
        >
          <label>
            Package
            <select value={code} onChange={(event) => setCode(event.target.value)}>
              {['FREE', 'STANDARD', 'PREMIUM'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Policy settings
            <textarea
              rows={14}
              value={settings}
              onChange={(event) => setSettings(event.target.value)}
            />
          </label>
          <label>
            Reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={8}
              maxLength={1000}
              required
            />
          </label>
          <button disabled={busy} className="primary">
            Create version
          </button>
        </form>
      </section>
      <section className="panel" style={{ padding: 24, marginTop: 16 }}>
        <h2>Package grant history</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ledger().catch((error) => setMessage(error.message));
          }}
        >
          <label>
            Company ID
            <input
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              required
            />
          </label>
          <button className="secondary">Show history</button>
        </form>
        {history && (
          <>
            <pre style={{ overflow: 'auto', maxHeight: 500 }}>
              {JSON.stringify(history, null, 2)}
            </pre>
            <button disabled={page === 1} onClick={() => void ledger(page - 1)}>
              Previous
            </button>
            <button
              disabled={
                history.grants.length < 50
              }
              onClick={() => void ledger(page + 1)}
            >
              Next
            </button>
          </>
        )}
      </section>
      <BenefitOperations />
      {message && <p role="status">{message}</p>}
    </>
  );
}
