'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n';
import { isPreviewableImageUrl } from '@/lib/image-preview';

type PreviewableImageProps = {
  src?: string | null;
  fallbackSrc?: string;
  className?: string;
  style?: CSSProperties;
  /** Stretch the trigger to fill a fixed tile (logo / crop preview). */
  fill?: boolean;
};

type DialogProps = {
  src: string;
  onClose: () => void;
};

function ImagePreviewDialog({ src, onClose }: DialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div
      className="modal-backdrop image-preview-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <span id={titleId} className="sr-only">
          {t('ui.previewPhoto')}
        </span>
        <button
          ref={closeRef}
          type="button"
          className="image-preview-close"
          onClick={onClose}
          aria-label={t('ui.closePreview')}
        >
          x
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" />
      </div>
    </div>
  );
}

export function PreviewableImage({
  src,
  fallbackSrc,
  className,
  style,
  fill = false,
}: PreviewableImageProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const previewable = isPreviewableImageUrl(src);
  const displaySrc = previewable ? src! : fallbackSrc || src || '';
  if (!displaySrc) return null;

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displaySrc} alt="" className={className} style={style} />
  );

  if (!previewable) return img;

  return (
    <>
      <button
        type="button"
        className={fill ? 'previewable-image previewable-image--fill' : 'previewable-image'}
        aria-label={t('ui.previewPhoto')}
        onClick={() => setOpen(true)}
      >
        {img}
      </button>
      {open ? <ImagePreviewDialog src={src!} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
