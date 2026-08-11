'use client';

import { useI18n } from '@/lib/i18n';
import { buildPageWindow, clampPage, pageRangeLabel } from '@/lib/pagination';

type Props = {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  /** Show jump-to-page when totalPages exceeds this (default 7). */
  jumpWhenAbove?: number;
  className?: string;
  /** Optional note when the result set was capped server-side. */
  truncatedNote?: string | null;
};

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  disabled = false,
  jumpWhenAbove = 7,
  className = '',
  truncatedNote = null,
}: Props) {
  const { t } = useI18n();
  const safeTotalPages = Math.max(1, totalPages || 1);
  const current = clampPage(page, safeTotalPages);
  const items = buildPageWindow(current, safeTotalPages, 1);
  const showJump = safeTotalPages > jumpWhenAbove;

  if (total <= 0) return null;

  return (
    <nav className={`pagination ${className}`.trim()} aria-label={t('ui.pagination')}>
      <div className="pagination-meta">
        <span className="pagination-range muted">
          {pageRangeLabel(current, limit, total, t('ui.pageRangeOf'))}
        </span>
        {truncatedNote ? <span className="pagination-truncated muted">{truncatedNote}</span> : null}
      </div>

      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-nav"
          disabled={disabled || current <= 1}
          onClick={() => onPageChange(1)}
          aria-label={t('ui.firstPage')}
          title={t('ui.firstPage')}
        >
          «
        </button>
        <button
          type="button"
          className="pagination-nav"
          disabled={disabled || current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label={t('ui.previousPage')}
        >
          ‹ {t('ui.prev')}
        </button>

        <div className="pagination-pages" role="list">
          {items.map((item, idx) =>
            item === '...' ? (
              <span key={`e-${idx}`} className="pagination-ellipsis" aria-hidden>
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                role="listitem"
                className={`pagination-page${item === current ? ' is-active' : ''}`}
                disabled={disabled || item === current}
                aria-current={item === current ? 'page' : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          className="pagination-nav"
          disabled={disabled || current >= safeTotalPages}
          onClick={() => onPageChange(current + 1)}
          aria-label={t('ui.nextPage')}
        >
          {t('ui.next')} ›
        </button>
        <button
          type="button"
          className="pagination-nav"
          disabled={disabled || current >= safeTotalPages}
          onClick={() => onPageChange(safeTotalPages)}
          aria-label={t('ui.lastPage')}
          title={t('ui.lastPage')}
        >
          »
        </button>
      </div>

      {showJump ? (
        <form
          className="pagination-jump"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const raw = Number(fd.get('page'));
            if (!Number.isFinite(raw)) return;
            onPageChange(clampPage(Math.floor(raw), safeTotalPages));
            e.currentTarget.reset();
          }}
        >
          <label className="pagination-jump-label muted" htmlFor="pagination-jump-input">
            {t('jumpToPage')}
          </label>
          <input
            id="pagination-jump-input"
            name="page"
            type="number"
            min={1}
            max={safeTotalPages}
            inputMode="numeric"
            placeholder={String(current)}
            className="pagination-jump-input"
            disabled={disabled}
            aria-label={t('ui.goToPageRange').replace('{n}', String(safeTotalPages))}
          />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={disabled}>
            {t('ui.go')}
          </button>
        </form>
      ) : null}
    </nav>
  );
}
