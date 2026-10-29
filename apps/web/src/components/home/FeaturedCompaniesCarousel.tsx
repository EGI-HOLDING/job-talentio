'use client';

import { useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import type { TopCompany } from './TopCompaniesCarousel';
import styles from './FeaturedCompaniesCarousel.module.css';

const SWIPE_THRESHOLD = 48;

function makePages(companies: TopCompany[]) {
  const pages: TopCompany[][] = [];
  for (let i = 0; i < companies.length; i += 12) pages.push(companies.slice(i, i + 12));
  return pages;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase();
}

function CompanyLogo({ company }: { company: TopCompany }) {
  const [failed, setFailed] = useState(!company.logoUrl);
  return (
    <Link
      href={`/companies/${encodeURIComponent(company.slug)}`}
      className={styles.company}
      title={company.name}
      draggable={false}
    >
      {failed ? (
        <span className={styles.monogram} aria-hidden="true">{initials(company.name)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logoUrl!} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      )}
      <span className={styles.companyName}>{company.name}</span>
    </Link>
  );
}

function Chevron({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {direction === 'previous' ? (
        <path d="m15.5 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m8.5 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function FeaturedCompaniesCarousel({ companies }: { companies: TopCompany[] }) {
  const { t } = useI18n();
  const pages = useMemo(() => makePages(companies), [companies]);
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const carouselRef = useRef<HTMLElement | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragOffset = useRef(0);
  const suppressClick = useRef(false);

  if (!pages.length) return null;
  const boundedPage = Math.min(page, pages.length - 1);
  const move = (direction: -1 | 1) => setPage((current) => (current + direction + pages.length) % pages.length);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    dragOffset.current = 0;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (!dragging && Math.abs(dx) < 10) return;
    if (!dragging && Math.abs(dy) >= Math.abs(dx)) {
      start.current = null;
      return;
    }
    if (!dragging) {
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    dragOffset.current = dx;
  }

  function onPointerUp() {
    if (!start.current) return;
    const dx = dragOffset.current;
    start.current = null;
    dragOffset.current = 0;
    if (!dragging) return;
    setDragging(false);
    suppressClick.current = true;
    if (dx >= SWIPE_THRESHOLD) move(-1);
    else if (dx <= -SWIPE_THRESHOLD) move(1);
  }

  return (
    <section
      ref={carouselRef}
      className={styles.carousel}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('topCompaniesCarousel')}
      onKeyDown={(event) => {
        if (pages.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const next = (boundedPage + (event.key === 'ArrowLeft' ? -1 : 1) + pages.length) % pages.length;
          setPage(next);
          requestAnimationFrame(() => {
            const pageElement = carouselRef.current?.querySelectorAll(`.${styles.page}`)[next];
            pageElement?.querySelector('a')?.focus();
          });
        }
      }}
    >
      {pages.length > 1 && (
        <button type="button" className={`${styles.arrow} ${styles.previous}`} aria-label={t('ui.previousPage')} onClick={() => move(-1)}>
          <Chevron direction="previous" />
        </button>
      )}
      <div
        className={styles.viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }}
      >
        <div className={styles.track} style={{ transform: `translateX(-${boundedPage * 100}%)`, transition: dragging ? 'none' : undefined }}>
          {pages.map((items, index) => (
            <div key={`featured-page-${index}`} className={styles.page} aria-hidden={index !== boundedPage} inert={index !== boundedPage}>
              {items.map((company) => <CompanyLogo key={company.slug} company={company} />)}
            </div>
          ))}
        </div>
      </div>
      {pages.length > 1 && (
        <button type="button" className={`${styles.arrow} ${styles.next}`} aria-label={t('ui.nextPage')} onClick={() => move(1)}>
          <Chevron direction="next" />
        </button>
      )}
      {pages.length > 1 && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {t('topCompaniesSlideStatus').replace('{current}', String(boundedPage + 1)).replace('{total}', String(pages.length))}
        </span>
      )}
    </section>
  );
}
