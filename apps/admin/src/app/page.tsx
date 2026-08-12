'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AdminMetrics, formatDateTime, type CatalogKind } from '@/lib/types';
import { PageHeader } from '@/components/shell/PageHeader';
import { Alert, Stat } from '@/components/ui/primitives';

type CatalogSummary = Record<CatalogKind, { pending: number; complete: number; ignored: number }>;

type Recent = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actor: { email: string } | null;
};

export default function OverviewPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [openReports, setOpenReports] = useState(0);
  const [bannedUsers, setBannedUsers] = useState(0);
  const [pausedJobs, setPausedJobs] = useState(0);
  const [catalogPending, setCatalogPending] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // One count query per card; `limit=1` keeps the payload tiny because
        // only the envelope total is used.
        const [m, reports, banned, paused, catalog, audit] = await Promise.all([
          api<AdminMetrics>('/admin/metrics'),
          api<{ total: number }>('/admin/reports?status=OPEN&limit=1'),
          api<{ total: number }>('/admin/users?banned=true&limit=1'),
          api<{ total: number }>('/admin/jobs?status=PAUSED&limit=1'),
          api<CatalogSummary>('/admin/catalog/i18n/summary'),
          api<{ items: Recent[] }>('/admin/audit-logs?limit=8'),
        ]);
        if (cancelled) return;
        setMetrics(m);
        setOpenReports(reports.total);
        setBannedUsers(banned.total);
        setPausedJobs(paused.total);
        setCatalogPending(
          Object.values(catalog).reduce((sum, entry) => sum + (entry?.pending ?? 0), 0),
        );
        setRecent(audit.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the overview');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader title="Overview" subtitle="Platform health and anything waiting on you" />

      <div className="content">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="grid">
          <Stat label="Users" value={metrics?.users ?? '-'} />
          <Stat label="Companies" value={metrics?.companies ?? '-'} />
          <Stat label="Published jobs" value={metrics?.publishedJobs ?? '-'} />
          <Stat label="Applications" value={metrics?.applications ?? '-'} />
          <Stat
            label="Revenue"
            value={(metrics?.revenueUzs ?? 0).toLocaleString()}
            foot="UZS, paid and mocked"
          />
        </div>

        <section className="card">
          <div className="card-head">
            <h2>Needs attention</h2>
          </div>
          <div className="grid">
            <Link href="/reports?status=OPEN" style={{ textDecoration: 'none' }}>
              <Stat
                label="Open reports"
                value={openReports}
                foot="Review the moderation queue"
                attention={openReports > 0}
              />
            </Link>
            <Link href="/catalog?status=PENDING" style={{ textDecoration: 'none' }}>
              <Stat
                label="Terms awaiting translation"
                value={catalogPending}
                foot="Across all catalogs"
                attention={catalogPending > 0}
              />
            </Link>
            <Link href="/jobs?status=PAUSED" style={{ textDecoration: 'none' }}>
              <Stat label="Paused jobs" value={pausedJobs} foot="Not visible to candidates" />
            </Link>
            <Link href="/users?banned=true" style={{ textDecoration: 'none' }}>
              <Stat label="Banned users" value={bannedUsers} foot="Blocked from signing in" />
            </Link>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Recent admin activity</h2>
            <Link href="/audit" className="btn secondary sm">
              Open audit log
            </Link>
          </div>
          {recent.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
              {recent.map((entry) => (
                <li
                  key={entry.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    fontSize: '0.85rem',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '0.4rem',
                  }}
                >
                  <span>
                    <span className="cell-strong">{entry.action}</span>{' '}
                    <span className="muted">on {entry.entityType}</span>
                  </span>
                  <span className="muted num">
                    {entry.actor?.email ?? 'System'} - {formatDateTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No admin actions recorded yet.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
