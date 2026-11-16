'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { useReviewCopy } from './candidate-review-view';
import s from './CandidateReview.module.css';

export function CandidatePdfPreview({ url, name, filename, initialPage = 1 }: {
  url: string; name: string; filename: string; initialPage?: number;
}) {
  const c = useReviewCopy();
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(530);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const available = element.clientWidth;
      setWidth(Math.max(175, window.matchMedia('(max-width: 680px)').matches
        ? available - 10 : Math.min(1086, available * .79)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    setPdf(undefined);
    setBusy(true);
    setError('');
    void import('pdfjs-dist').then(lib => {
      if (!active) return;
      lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      task = lib.getDocument({ url, disableAutoFetch: true });
      return task.promise;
    }).then(document => {
      if (active && document) setPdf(document);
    }).catch(() => {
      if (active) { setBusy(false); setError('document'); }
    });
    return () => { active = false; void task?.destroy(); };
  }, [url]);
  useEffect(() => {
    if (pdf) {
      setPage(Math.max(1, Math.min(initialPage, pdf.numPages)));
      container.current?.scrollTo(0, 0);
    }
  }, [pdf, initialPage]);
  useEffect(() => {
    const element = canvas.current;
    if (!pdf || !element) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setBusy(true);
    setError('');
    void pdf.getPage(page).then(async current => {
      if (!active) return;
      const base = current.getViewport({ scale: 1 });
      const viewport = current.getViewport({ scale: Math.min(3, width * zoom / base.width) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.floor(viewport.width * ratio);
      element.height = Math.floor(viewport.height * ratio);
      element.style.width = Math.floor(viewport.width) + 'px';
      element.style.height = Math.floor(viewport.height) + 'px';
      render = current.render({ canvas: element, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (active) setBusy(false);
    }).catch(() => {
      if (active) { setBusy(false); setError('page'); }
    });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, width, zoom]);

  function move(step: number) {
    setPage(value => value + step);
    container.current?.scrollTo(0, 0);
  }

  return <section className={s.document}>
    <header className={s.documentToolbar}>
      <strong>{c('CV asli', 'Original CV')}</strong>
      <a href={url} target="_blank" rel="noreferrer" className={s.documentFilename}
        aria-label={c('Buka CV asli', 'Open original CV')} title={filename}><WorkspaceIcon kind="file" /><span>{filename}</span></a>
      {pdf && <nav className={s.documentControls} aria-label={c('Halaman CV', 'CV pages')}>
        <button type="button" className={s.square} disabled={page <= 1 || busy}
          aria-label={c('Halaman CV sebelumnya', 'Previous CV page')} onClick={() => move(-1)}><DirectionalIcon direction="left" size={16} /></button>
        <span>{page} / {pdf.numPages}</span>
        <button type="button" className={s.square} disabled={page >= pdf.numPages || busy}
          aria-label={c('Halaman CV berikutnya', 'Next CV page')} onClick={() => move(1)}><DirectionalIcon direction="right" size={16} /></button>
        <div className={s.documentZoom}>
          {[{ step: -.25, label: c('Perkecil CV', 'Zoom out'), icon: 'zoomOut' },
            { step: .25, label: c('Perbesar CV', 'Zoom in'), icon: 'zoomIn' }].map(({ step, label, icon }) =>
              <button type="button" key={icon} disabled={busy || zoom + step > 2 || zoom + step < .5}
                aria-label={label} onClick={() => setZoom(value => value + step)}><WorkspaceIcon kind={icon} /></button>)}
        </div>
      </nav>}
    </header>
    <div ref={container} className={s.documentPages}>
      {busy && <p role="status" className={s.muted}>{c('Memuat halaman CV\u2026', 'Loading CV page\u2026')}</p>}
      {error && <div className={s.empty}>
        <p>{c('Pratinjau belum dapat ditampilkan.', 'The preview could not be displayed.')}</p>
        <a href={url} target="_blank" rel="noreferrer" className={s.secondary}>{c('Buka CV asli', 'Open original CV')}</a>
      </div>}
      <canvas ref={canvas} hidden={Boolean(error) || !pdf} role="img" aria-label={c('Halaman CV ', 'CV page ') + page + ' \u00b7 ' + name}
        data-rendered={pdf && !busy && !error ? 'true' : 'false'} />
    </div>
  </section>;
}
