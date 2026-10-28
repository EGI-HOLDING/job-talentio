'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { CV_ACCEPT } from './types';
import { ProfileIcon } from './ProfileIcon';
import s from './ProfileWorkspace.module.css';

export function CvFileDrop({ file, onPick, disabled = false }: { file: File | null; onPick: (file: File | null) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [dragging, setDragging] = useState(false);
  return <>
    <label className={s.fileDrop} data-dragging={dragging} onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled && event.dataTransfer.files[0]) onPick(event.dataTransfer.files[0]); }}>
      <ProfileIcon kind="upload" /><strong>{t('pc.dropFile')}</strong><small>{t('pc.fileHint')}</small>
      <input type="file" accept={CV_ACCEPT} disabled={disabled} aria-label={t('pc.chooseFile')} onChange={(event) => { if (event.target.files?.[0]) onPick(event.target.files[0]); event.currentTarget.value = ''; }} />
    </label>
    {file && <div className={s.fileSelected}><ProfileIcon /><div>{file.name}<small>{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(file.size / 1024)} KB</small></div><button type="button" className={s.iconButton} disabled={disabled} aria-label={t('pc.remove')} onClick={() => onPick(null)}><ProfileIcon kind="close" /></button></div>}
  </>;
}
