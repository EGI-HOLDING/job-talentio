'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { readIdentity, signOut } from './AuthGate';

type NavEntry = { href: string; label: string; countKey?: 'reports' | 'catalog' };

const PRIMARY: NavEntry[] = [{ href: '/', label: 'Overview' }];

const DIRECTORY: NavEntry[] = [
  { href: '/users', label: 'Users' },
  { href: '/companies', label: 'Companies' },
  { href: '/jobs', label: 'Jobs' },
];

const OPERATIONS: NavEntry[] = [
  { href: '/reports', label: 'Reports', countKey: 'reports' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/catalog/translations', label: 'Translations', countKey: 'catalog' },
  { href: '/flags', label: 'Feature flags' },
  { href: '/audit', label: 'Audit log' },
];

type CatalogSummary = Record<string, { pending: number }>;

export function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{ reports: number; catalog: number }>({
    reports: 0,
    catalog: 0,
  });
  const [identity, setIdentity] = useState<{ email: string; fullName: string } | null>(null);

  useEffect(() => {
    setIdentity(readIdentity());
  }, []);

  // Pending work is shown in the nav so an admin does not have to open each
  // section to discover there is nothing to do.
  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      try {
        const [reports, catalog] = await Promise.all([
          api<{ total: number }>('/admin/reports?status=OPEN&limit=1'),
          api<CatalogSummary>('/admin/catalog/i18n/summary'),
        ]);
        if (cancelled) return;
        const catalogPending = Object.values(catalog).reduce(
          (sum, entry) => sum + (entry?.pending ?? 0),
          0,
        );
        setCounts({ reports: reports.total, catalog: catalogPending });
      } catch {
        // Counts are a convenience; navigation still works without them.
      }
    }
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Longest match wins, otherwise /catalog would light up while the reader is
  // on /catalog/translations.
  const activeHref = [...PRIMARY, ...DIRECTORY, ...OPERATIONS]
    .map((entry) => entry.href)
    .filter((href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];

  function renderItem(entry: NavEntry) {
    const active = entry.href === activeHref;
    const count = entry.countKey ? counts[entry.countKey] : 0;
    return (
      <Link
        key={entry.href}
        href={entry.href}
        className="nav-item"
        aria-current={active ? 'page' : undefined}
      >
        <span>{entry.label}</span>
        {count > 0 ? <span className="nav-count">{count}</span> : null}
      </Link>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden>
          JT
        </span>
        <span>Admin</span>
      </div>

      <nav aria-label="Sections" style={{ display: 'grid', gap: '0.15rem' }}>
        {PRIMARY.map(renderItem)}
        <div className="sidebar-section">Directory</div>
        {DIRECTORY.map(renderItem)}
        <div className="sidebar-section">Operations</div>
        {OPERATIONS.map(renderItem)}
      </nav>

      <div className="sidebar-foot">
        {identity ? (
          <div style={{ fontSize: '0.75rem' }}>
            <div className="dim" style={{ fontWeight: 600 }}>
              {identity.fullName}
            </div>
            <div className="muted">{identity.email}</div>
          </div>
        ) : null}
        <button type="button" className="secondary sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
