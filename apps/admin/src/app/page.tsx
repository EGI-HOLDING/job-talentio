'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, clearToken, getToken, saveToken } from '@/lib/api';
import { CatalogI18nPanel } from '@/components/CatalogI18nPanel';

function EyeIcon({ crossed }: { crossed?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {crossed ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);

  const [reports, setReports] = useState<any[]>([]);

  async function load() {
    const [m, u, c, j, l, f, r] = await Promise.all([
      api('/admin/metrics'),
      api('/admin/users'),
      api('/admin/companies'),
      api('/admin/jobs'),
      api('/admin/audit-logs'),
      api('/admin/flags'),
      api('/admin/reports'),
    ]);
    setMetrics(m);
    setUsers(u as any[]);
    setCompanies(c as any[]);
    setJobs(j as any[]);
    setLogs(l as any[]);
    setFlags(f as any[]);
    setReports(r as any[]);
  }

  useEffect(() => {
    if (getToken()) {
      setAuthed(true);
      load().catch((e) => setError(e.message));
    }
  }, []);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const session = await api<any>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: String(fd.get('email') ?? '').trim(),
          password: fd.get('password'),
        }),
      });
      if (session.user.role !== 'SUPER_ADMIN') {
        throw new Error('Not a Super Admin account');
      }
      saveToken(session.accessToken, session.refreshToken);
      setAuthed(true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!authed) {
    return (
      <main style={{ maxWidth: 420, margin: '4rem auto', padding: '1rem' }}>
        <div className="card">
          <h2>Super Admin Login</h2>
          <p className="muted">Sign in with your Job Talentio super admin account.</p>
          <form
            onSubmit={login}
            className="row"
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}
            noValidate
          >
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>
                Email{' '}
                <abbr style={{ color: 'var(--danger)', textDecoration: 'none' }} title="Required">
                  *
                </abbr>
                <span className="sr-only"> (required)</span>
              </span>
              <input
                name="email"
                type="email"
                required
                aria-required="true"
                autoComplete="username"
                spellCheck={false}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>
                Password{' '}
                <abbr style={{ color: 'var(--danger)', textDecoration: 'none' }} title="Required">
                  *
                </abbr>
                <span className="sr-only"> (required)</span>
              </span>
              <div className="pw-field">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  aria-required="true"
                  autoComplete="current-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="pw-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <EyeIcon crossed={showPassword} />
                  <span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>
                </button>
              </div>
            </label>
            {error && (
              <p className="error" role="alert" aria-live="polite">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="layout">
      <aside className="side">
        <h1>Job Talentio Admin</h1>
        <a href="#metrics">Metrics</a>
        <a href="#users">Users</a>
        <a href="#companies">Companies</a>
        <a href="#jobs">Jobs</a>
        <a href="#catalog-i18n">Catalog translations</a>
        <a href="#flags">Feature flags</a>
        <a href="#reports">Reports</a>
        <a href="#audit">Audit log</a>
        <button
          className="secondary"
          style={{ marginTop: '1rem' }}
          onClick={() => {
            clearToken();
            setAuthed(false);
          }}
        >
          Logout
        </button>
      </aside>
      <main className="main">
        {error && <p className="error">{error}</p>}

        <section id="metrics" className="card">
          <h2>Metrics</h2>
          <div className="grid">
            <div>
              <div className="muted">Users</div>
              <div className="metric">{metrics?.users ?? '-'}</div>
            </div>
            <div>
              <div className="muted">Companies</div>
              <div className="metric">{metrics?.companies ?? '-'}</div>
            </div>
            <div>
              <div className="muted">Published jobs</div>
              <div className="metric">{metrics?.publishedJobs ?? '-'}</div>
            </div>
            <div>
              <div className="muted">Applications</div>
              <div className="metric">{metrics?.applications ?? '-'}</div>
            </div>
            <div>
              <div className="muted">Revenue (UZS)</div>
              <div className="metric">{(metrics?.revenueUzs ?? 0).toLocaleString()}</div>
            </div>
          </div>
        </section>

        <section id="users" className="card">
          <h2>Users</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Banned</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.isBanned ? 'yes' : 'no'}</td>
                  <td>
                    <button
                      className={u.isBanned ? 'secondary' : 'danger'}
                      onClick={async () => {
                        await api(`/admin/users/${u.id}/ban`, {
                          method: 'POST',
                          body: JSON.stringify({ banned: !u.isBanned }),
                        });
                        await load();
                      }}
                    >
                      {u.isBanned ? 'Unban' : 'Ban'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="companies" className="card">
          <h2>Companies</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Plan</th>
                <th>Jobs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.subscription?.plan}</td>
                  <td>{c._count?.jobPosts}</td>
                  <td className="row">
                    {(['FREE', 'STANDARD', 'PREMIUM', 'VIP'] as const).map((plan) => (
                      <button
                        key={plan}
                        className="secondary"
                        onClick={async () => {
                          await api(`/admin/companies/${c.id}/plan`, {
                            method: 'POST',
                            body: JSON.stringify({ plan }),
                          });
                          await load();
                        }}
                      >
                        {plan}
                      </button>
                    ))}
                    <button
                      className="danger"
                      onClick={async () => {
                        await api(`/admin/companies/${c.id}/ban`, {
                          method: 'POST',
                          body: JSON.stringify({ banned: !c.isBanned }),
                        });
                        await load();
                      }}
                    >
                      {c.isBanned ? 'Unban' : 'Ban'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="jobs" className="card">
          <h2>Jobs</h2>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Company</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.title}</td>
                  <td>{j.company?.name}</td>
                  <td>{j.status}</td>
                  <td className="row">
                    <button
                      className="secondary"
                      onClick={async () => {
                        await api(`/admin/jobs/${j.id}/status`, {
                          method: 'POST',
                          body: JSON.stringify({ status: 'PAUSED' }),
                        });
                        await load();
                      }}
                    >
                      Force pause
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        await api(`/admin/jobs/${j.id}/hot`, {
                          method: 'POST',
                          body: JSON.stringify({ days: 7 }),
                        });
                        await load();
                      }}
                    >
                      Hot 7d
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <CatalogI18nPanel />

        <section id="flags" className="card">
          <h2>Feature flags</h2>
          <ul>
            {flags.map((f) => (
              <li key={f.id}>
                {f.key}: {f.enabled ? 'ON' : 'OFF'}
              </li>
            ))}
          </ul>
          <button
            onClick={async () => {
              await api('/admin/flags', {
                method: 'POST',
                body: JSON.stringify({ key: 'maintenance_mode', enabled: false }),
              });
              await load();
            }}
          >
            Ensure maintenance_mode flag
          </button>
        </section>

        <section id="reports" className="card">
          <h2>Reports moderation</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Reporter</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.reporter?.email}</td>
                  <td>
                    {r.entityType} {r.entityId?.slice(0, 8)}
                  </td>
                  <td>{r.reason}</td>
                  <td>{r.status}</td>
                  <td className="row">
                    {r.status === 'OPEN' && (
                      <>
                        <button
                          className="secondary"
                          onClick={async () => {
                            await api(`/admin/reports/${r.id}/resolve`, {
                              method: 'POST',
                              body: JSON.stringify({ status: 'RESOLVED' }),
                            });
                            await load();
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          className="danger"
                          onClick={async () => {
                            await api(`/admin/reports/${r.id}/resolve`, {
                              method: 'POST',
                              body: JSON.stringify({ status: 'DISMISSED' }),
                            });
                            await load();
                          }}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="audit" className="card">
          <h2>Audit log</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.createdAt).toLocaleString()}</td>
                  <td>{l.actor?.email || '-'}</td>
                  <td>{l.action}</td>
                  <td>
                    {l.entityType} {l.entityId?.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
