'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';

type Category = { name: string; slug: string; icon?: string | null };
type Job = {
  id: string;
  title: string;
  isHot?: boolean;
  workMode?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string } | null;
};

function formatSalary(min?: number | null, max?: number | null) {
  if (!min && !max) return null;
  const fmt = (n: number) => `${Math.round(n / 1_000_000)}M`;
  if (min && max) return `${fmt(min)}–${fmt(max)} UZS`;
  return `${fmt(min || max!)} UZS`;
}

export default function HomePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [hotJobs, setHotJobs] = useState<Job[]>([]);
  const [companies, setCompanies] = useState<Array<{ name: string; logoUrl?: string | null; slug: string }>>([]);

  useEffect(() => {
    api<Category[]>('/meta/categories', { auth: false }).then(setCategories).catch(() => undefined);
    api<{ items: Job[] }>('/jobs?hotOnly=true&limit=6&sort=relevance', { auth: false })
      .then((r) => {
        setHotJobs(r.items);
        setCompanies(
          Array.from(
            new Map(r.items.map((j) => [j.company.slug, j.company])).values(),
          ),
        );
      })
      .catch(() => undefined);
  }, []);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q') as string;
    router.push(`/jobs?q=${encodeURIComponent(q || '')}`);
  }

  return (
    <div className="shell">
      <section className="hero">
        <span className="badge">Uzbekistan · uz / ru / en</span>
        <h1>Find work that fits. Hire talent that delivers.</h1>
        <p>
          Job Talentio connects candidates and companies across Uzbekistan with smart matching,
          advanced search, and a lightweight ATS.
        </p>
        <form className="hero-search" onSubmit={onSearch}>
          <input name="q" placeholder="Job title, skill, or company…" aria-label="Search jobs" />
          <button type="submit" className="cta">
            Search jobs
          </button>
        </form>
        <div className="chips">
          {categories.slice(0, 8).map((c) => (
            <Link key={c.slug} href={`/jobs?category=${c.slug}`} className="chip">
              {c.icon} {c.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="stats-row">
          <div className="stat">
            <strong>40+</strong>
            <span>Open roles</span>
          </div>
          <div className="stat">
            <strong>10</strong>
            <span>Companies</span>
          </div>
          <div className="stat">
            <strong>30+</strong>
            <span>Talent profiles</span>
          </div>
          <div className="stat">
            <strong>15</strong>
            <span>Cities covered</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="section-title">Hot jobs</h2>
          <Link href="/jobs?hotOnly=true" className="muted">
            View all →
          </Link>
        </div>
        <div className="grid-2">
          {hotJobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="card job-card" style={{ margin: 0, gridTemplateColumns: '48px 1fr' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="company-logo"
                src={job.company.logoUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${job.company.name}`}
                alt=""
                style={{ width: 48, height: 48 }}
              />
              <div>
                <span className="badge hot">Hot</span>
                <h3>{job.title}</h3>
                <div className="job-meta">
                  <span>{job.company.name}</span>
                  <span>{jobLocationLabel(job)}</span>
                  {formatSalary(job.salaryMin, job.salaryMax) && (
                    <span className="salary" style={{ fontSize: '0.9rem' }}>
                      {formatSalary(job.salaryMin, job.salaryMax)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
          {!hotJobs.length && <p className="muted">Hot jobs will appear after seed data loads.</p>}
        </div>
      </section>

      {companies.length > 0 && (
        <section className="section">
          <h2 className="section-title">Hiring now</h2>
          <div className="logo-strip">
            {companies.map((c) => (
              <Link key={c.slug} href={`/companies/${c.slug}`} title={c.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.logoUrl || ''} alt={c.name} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section grid-3" style={{ paddingBottom: '3rem' }}>
        <div className="card">
          <h3>For candidates</h3>
          <p className="muted">Profile, skills, CV upload, match scores, alerts, and chat.</p>
        </div>
        <div className="card">
          <h3>For companies</h3>
          <p className="muted">Pipeline, candidate matching, Hot Jobs, screening questions.</p>
        </div>
        <div className="card">
          <h3>Enterprise-ready</h3>
          <p className="muted">Normalized data, analytics, notifications, moderation tools.</p>
        </div>
      </section>
    </div>
  );
}
