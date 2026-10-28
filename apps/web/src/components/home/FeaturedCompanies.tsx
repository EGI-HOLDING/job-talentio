'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
export function FeaturedCompanies() {
  const { t } = useI18n();
  const [companies, setCompanies] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<any[]>('/benefits/featured', { auth: false })
        .then((data) => {
          if (alive) setCompanies(data);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!companies.length) return null;
  return (
    <section style={{ paddingBlock: 24 }}>
      <h2>{t('hr.featured')}</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {companies.map((company) => (
          <Link
            key={company.id}
            href={'/companies/' + company.slug}
            style={{
              padding: 20,
              border: '1px solid #e1e6f0',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {company.logoUrl && <img src={company.logoUrl} alt="" width={40} height={40} />}
            <strong>{company.name}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}
