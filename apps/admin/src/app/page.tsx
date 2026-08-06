'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, clearToken, getToken, saveToken } from '@/lib/api';

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState('');
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
    const fd = new FormData(e.currentTarget);
    try {
      const session = await api<any>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: fd.get('email'),
          password: fd.get('password'),
        }),
      });
      if (session.user.role !== 'SUPER_ADMIN') {
        throw new Error('Not a Super Admin account');
      }
      saveToken(session.accessToken);
      setAuthed(true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!authed) {
    return (
      <main style={{ maxWidth: 420, margin: '4rem auto', padding: '1rem' }}>
        <div className="card">
          <h2>Super Admin Login</h2>
          <p className="muted">Bootstrap credentials from .env</p>
          <form onSubmit={login} className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <input name="email" type="email" defaultValue="admin@jobtalentio.local" required />
            <input name="password" type="password" defaultValue="Admin123!" required />
            {error && <p className="error">{error}</p>}
            <button type="submit">Sign in</button>
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
              <div className="metric">{metrics?.users ?? '—'}</div>
            </div>
            <div>
              <div className="muted">Companies</div>
              <div className="metric">{metrics?.companies ?? '—'}</div>
            </div>
            <div>
              <div className="muted">Published jobs</div>
              <div className="metric">{metrics?.publishedJobs ?? '—'}</div>
            </div>
            <div>
              <div className="muted">Applications</div>
              <div className="metric">{metrics?.applications ?? '—'}</div>
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
                    {(['FREE', 'STANDARD', 'PREMIUM'] as const).map((plan) => (
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
                  <td>{l.actor?.email || '—'}</td>
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
