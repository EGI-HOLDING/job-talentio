'use client';
import { useState } from 'react';
import { postOnce } from '@/lib/operations';
export function JobPackageGrant({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false),
    [code, setCode] = useState('STANDARD'),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function grant(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postOnce('/admin/benefits/jobs/' + jobId + '/grants', { code, reason });
      setOpen(false);
      setReason('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Grant failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="ghost" type="button" onClick={() => setOpen(!open)}>
        Package
      </button>
      {open && (
        <form
          onSubmit={(event) => void grant(event)}
          style={{ display: 'grid', gap: 8, minWidth: 220, padding: 12 }}
        >
          <label>
            Upgrade to
            <select
              value={code}
              disabled={busy}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            >
              <option>STANDARD</option>
              <option>PREMIUM</option>
            </select>
          </label>
          <label>
            Reason
            <textarea
              value={reason}
              minLength={8}
              maxLength={1000}
              required
              disabled={busy}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <small>
            Draft benefits start at first publication. Upgrades add only the remaining difference
            and do not extend the posting period.
          </small>
          <button className="primary" disabled={busy} type="submit">
            Grant package
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
