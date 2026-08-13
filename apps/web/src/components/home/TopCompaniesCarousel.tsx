'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type TransitionEvent,
} from 'react';
import { ExploreCompanyCard } from '@/components/explore/ExploreCompanyCard';
import { useI18n } from '@/lib/i18n';

export type TopCompany = {
  slug: string;
  name: string;
  logoUrl?: string | null;
  plan?: string;
  openJobsCount: number;
};

const ROWS = 3;
const AUTO_MS = 2000;
const SWIPE_PX = 48;
/** Keep in sync with `.explore-grid--company` breakpoints in globals.css. */
const MQ_MOBILE = '(max-width: 520px)';
const MQ_TABLET = '(max-width: 900px)';
const MQ_REDUCE = '(prefers-reduced-motion: reduce)';
const MQ_HOVER = '(hover: hover)';

type Props = {
  companies: TopCompany[];
};

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

function gridColsFromViewport(): number {
  if (typeof window === 'undefined') return 4;
  if (window.matchMedia(MQ_MOBILE).matches) return 1;
  if (window.matchMedia(MQ_TABLET).matches) return 2;
  return 4;
}

function realPageIndex(index: number, pageCount: number, loop: boolean): number {
  if (!loop || pageCount <= 0) return index;
  if (index === 0) return pageCount - 1;
  if (index === pageCount + 1) return 0;
  return index - 1;
}

function Chevron({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      {dir === 'prev' ? (
        <path
          d="M14.5 5.5L8.5 12l6 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M9.5 5.5L15.5 12l-6 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function CompanyCards({ companies, prefix }: { companies: TopCompany[]; prefix: string }) {
  const { t } = useI18n();
  const vipLabel = t('vipBadge');
  return (
    <>
      {companies.map((c) => (
        <ExploreCompanyCard
          key={`${prefix}-${c.slug}`}
          name={c.name}
          slug={c.slug}
          logoUrl={c.logoUrl}
          plan={c.plan || 'VIP'}
          vipLabel={vipLabel}
          count={c.openJobsCount}
          countLabel={t('openRolesCount').replace('{n}', String(c.openJobsCount))}
        />
      ))}
    </>
  );
}

export function TopCompaniesCarousel({ companies }: Props) {
  const [cols, setCols] = useState(gridColsFromViewport);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mqMobile = window.matchMedia(MQ_MOBILE);
    const mqTablet = window.matchMedia(MQ_TABLET);
    const mqReduce = window.matchMedia(MQ_REDUCE);
    const sync = () => {
      setCols(gridColsFromViewport());
      setReduceMotion(mqReduce.matches);
    };
    sync();
    mqMobile.addEventListener('change', sync);
    mqTablet.addEventListener('change', sync);
    mqReduce.addEventListener('change', sync);
    return () => {
      mqMobile.removeEventListener('change', sync);
      mqTablet.removeEventListener('change', sync);
      mqReduce.removeEventListener('change', sync);
    };
  }, []);

  const pageSize = cols * ROWS;
  const pages = useMemo(() => chunk(companies, pageSize), [companies, pageSize]);

  if (pages.length <= 1) {
    return (
      <div className="explore-grid explore-grid--company">
        <CompanyCards companies={companies} prefix="all" />
      </div>
    );
  }

  return (
    <TopCompaniesCarouselTrack
      key={`${pageSize}-${pages.length}-${reduceMotion ? 'r' : 'm'}`}
      pages={pages}
      reduceMotion={reduceMotion}
    />
  );
}

function TopCompaniesCarouselTrack({
  pages,
  reduceMotion,
}: {
  pages: TopCompany[][];
  reduceMotion: boolean;
}) {
  const { t } = useI18n();
  const pageCount = pages.length;
  const loop = pageCount > 1 && !reduceMotion;
  const slides = useMemo(
    () => (loop ? [pages[pageCount - 1], ...pages, pages[0]] : pages),
    [loop, pages, pageCount],
  );

  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [index, setIndex] = useState(loop ? 1 : 0);
  const [withMotion, setWithMotion] = useState(true);
  const [tick, setTick] = useState(0);
  const [drag, setDrag] = useState(0);

  const indexRef = useRef(index);
  const tracking = useRef(false);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragX = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useLayoutEffect(() => {
    if (withMotion) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setWithMotion(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [withMotion, index]);

  const bump = useCallback(() => setTick((n) => n + 1), []);

  const go = useCallback(
    (dir: 1 | -1) => {
      setWithMotion(!reduceMotion);
      if (loop) setIndex((i) => i + dir);
      else setIndex((i) => (i + dir + pageCount) % pageCount);
      bump();
    },
    [bump, loop, pageCount, reduceMotion],
  );

  const goTo = useCallback(
    (page: number) => {
      setWithMotion(!reduceMotion);
      setIndex(loop ? page + 1 : page);
      bump();
    },
    [bump, loop, reduceMotion],
  );

  const onTrackTransitionEnd = useCallback(
    (e: TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== 'transform') return;
      if (!loop) return;
      const i = indexRef.current;
      if (i === slides.length - 1) {
        setWithMotion(false);
        setIndex(1);
      } else if (i === 0) {
        setWithMotion(false);
        setIndex(pageCount);
      }
    },
    [loop, pageCount, slides.length],
  );

  const paused = hover || hidden || drag !== 0;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const autoplay = !reduceMotion && !paused;

  const onProgressEnd = useCallback(
    (e: AnimationEvent<HTMLSpanElement>) => {
      if (e.target !== e.currentTarget) return;
      if (pausedRef.current) return;
      go(1);
    },
    [go],
  );

  const onMouseEnter = () => {
    if (window.matchMedia(MQ_HOVER).matches) setHover(true);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tracking.current = true;
    dragging.current = false;
    startX.current = e.clientX;
    startY.current = e.clientY;
    dragX.current = 0;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!tracking.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (!dragging.current) {
      if (Math.abs(dx) < 12) return;
      if (Math.abs(dx) < Math.abs(dy)) {
        tracking.current = false;
        return;
      }
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    dragX.current = dx;
    setDrag(dx);
  };

  const onPointerUp = () => {
    if (!tracking.current) return;
    tracking.current = false;
    const dx = dragX.current;
    const wasDrag = dragging.current;
    dragging.current = false;
    dragX.current = 0;
    setDrag(0);
    if (!wasDrag) return;
    suppressClick.current = true;
    if (dx > SWIPE_PX) go(-1);
    else if (dx < -SWIPE_PX) go(1);
  };

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick.current = false;
  };

  const realIndex = realPageIndex(index, pageCount, loop);
  const offset = `calc(${-index * 100}% + ${drag}px)`;
  const trackStyle: CSSProperties = {
    transform: `translate3d(${offset}, 0, 0)`,
    transition: !withMotion || drag !== 0 || reduceMotion ? 'none' : undefined,
  };

  return (
    <div
      className={`top-companies-carousel${autoplay ? '' : ' is-paused'}`}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('topCompaniesCarousel')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => setHover(false)}
    >
      {!reduceMotion ? (
        <div className="top-companies-carousel__progress" aria-hidden>
          <span
            key={tick}
            className="top-companies-carousel__progress-bar"
            style={{ animationDuration: `${AUTO_MS}ms` }}
            onAnimationEnd={onProgressEnd}
          />
        </div>
      ) : null}

      <button
        type="button"
        className="top-companies-carousel__nav top-companies-carousel__nav--prev"
        aria-label={t('ui.previousPage')}
        onClick={() => go(-1)}
      >
        <Chevron dir="prev" />
      </button>

      <div
        className="top-companies-carousel__viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div
          className="top-companies-carousel__track"
          style={trackStyle}
          onTransitionEnd={onTrackTransitionEnd}
        >
          {slides.map((items, slideIdx) => {
            const isClone = loop && (slideIdx === 0 || slideIdx === slides.length - 1);
            return (
              <div
                key={`slide-${slideIdx}`}
                className="top-companies-carousel__page explore-grid explore-grid--company"
                aria-hidden={isClone}
                inert={isClone}
              >
                <CompanyCards companies={items} prefix={`s${slideIdx}`} />
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="top-companies-carousel__nav top-companies-carousel__nav--next"
        aria-label={t('ui.nextPage')}
        onClick={() => go(1)}
      >
        <Chevron dir="next" />
      </button>

      <div className="top-companies-carousel__dots" role="tablist">
        {pages.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            className={`top-companies-carousel__dot${i === realIndex ? ' is-active' : ''}`}
            aria-label={t('topCompaniesGoToSlide').replace('{n}', String(i + 1))}
            aria-selected={i === realIndex}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}
