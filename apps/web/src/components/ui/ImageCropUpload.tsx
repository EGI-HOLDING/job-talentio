'use client';

import { useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { getToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PreviewableImage } from '@/components/ui/ImagePreview';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Mode = 'avatar' | 'logo';

type Props = {
  mode: Mode;
  /** Current image URL for preview */
  value?: string | null;
  /** Upload path under /api, e.g. /auth/me/avatar or /companies/:id/logo */
  uploadPath: string;
  /** Optional DELETE path to clear */
  clearPath?: string;
  onUploaded: (url: string | null) => void;
  label?: string;
};

async function cropToBlob(
  imageSrc: string,
  crop: Area,
  mime: string,
  maxDim: number,
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;
  });
  const canvas = document.createElement('canvas');
  const size = Math.min(maxDim, Math.max(crop.width, crop.height));
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  if (modeNeedsPad(mime)) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size,
    size,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      mime,
      0.92,
    );
  });
}

function modeNeedsPad(_mime: string) {
  return true;
}

export function ImageCropUpload({
  mode,
  value,
  uploadPath,
  clearPath,
  onUploaded,
  label,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onCropComplete = useCallback((_a: Area, pixels: Area) => {
    setArea(pixels);
  }, []);

  function onPick(file: File | null) {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('ui.pickImageFile'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSrc(String(reader.result));
      setOpen(true);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
    };
    reader.readAsDataURL(file);
  }

  async function uploadBlob(blob: Blob) {
    const fd = new FormData();
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    fd.append('file', blob, `${mode}.${ext}`);
    const token = getToken();
    const res = await fetch(`${API_URL}/api${uploadPath}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.message === 'string' ? data.message : t('ui.uploadFailed'),
      );
    }
    return data;
  }

  async function confirmCrop() {
    if (!src || !area) return;
    setBusy(true);
    setError('');
    try {
      const mime = mode === 'logo' ? 'image/png' : 'image/jpeg';
      const blob = await cropToBlob(src, area, mime, 1024);
      if (blob.size > 2 * 1024 * 1024) {
        throw new Error(t('ui.cropTooLarge'));
      }
      const data = await uploadBlob(blob);
      const url =
        mode === 'avatar'
          ? ((data?.user?.avatarUrl as string | undefined) ??
            (data?.avatarUrl as string | undefined))
          : (data?.logoUrl as string | undefined);
      if (mode === 'avatar' && data?.accessToken && data?.user) {
        const { saveSession } = await import('@/lib/api');
        saveSession(data as never);
      }
      onUploaded(url || null);
      setOpen(false);
      setSrc(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ui.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function clearImage() {
    if (!clearPath) {
      onUploaded(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api${clearPath}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data?.message === 'string' ? data.message : t('ui.clearFailed'),
        );
      }
      const data = await res.json().catch(() => ({}));
      if (mode === 'avatar') {
        onUploaded(data?.user?.avatarUrl ?? null);
      } else {
        onUploaded(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ui.clearFailed'));
    } finally {
      setBusy(false);
    }
  }

  const preview =
    value ||
    (mode === 'avatar'
      ? undefined
      : undefined);

  return (
    <div className="form-stack" style={{ gap: '0.65rem' }}>
      {label && <strong style={{ fontSize: '0.9rem' }}>{label}</strong>}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          className={mode === 'logo' ? 'company-logo-tile' : undefined}
          style={{
            width: 72,
            height: 72,
            borderRadius: mode === 'avatar' ? '50%' : 12,
            overflow: 'hidden',
            background: 'var(--surface-2, #f3f4f6)',
            border: '1px solid var(--border, #e5e7eb)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          {preview ? (
            <PreviewableImage
              src={preview}
              fill
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {t('ui.noImage')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label className="chip" style={{ cursor: 'pointer' }}>
            {t('ui.uploadAndCrop')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                onPick(e.target.files?.[0] || null);
                e.target.value = '';
              }}
            />
          </label>
          {(value || clearPath) && (
            <button type="button" className="secondary" disabled={busy} onClick={clearImage}>
              {t('ui.remove')}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}

      {open && src && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
          }}
        >
          <div
            className="card"
            style={{ width: 'min(480px, 100%)', margin: 0, padding: '1rem' }}
          >
            <h3 style={{ marginTop: 0 }}>
              {mode === 'avatar' ? t('ui.cropPhoto') : t('ui.cropLogo')}
            </h3>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 280,
                background: '#111',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape={mode === 'avatar' ? 'round' : 'rect'}
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <label style={{ display: 'block', marginTop: '0.75rem' }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {t('ui.zoom')}
              </span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="button" className="cta" disabled={busy} onClick={confirmCrop}>
                {busy ? t('ui.uploading') : t('save')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setSrc(null);
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
