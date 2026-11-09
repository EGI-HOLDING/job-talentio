'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import s from './CandidateCvFiles.module.css';

type Props = {
  files: File[];
  setFiles: Dispatch<SetStateAction<File[]>>;
  disabled?: boolean;
  illustrated?: boolean;
};

export function CandidateCvFiles({ files, setFiles, disabled, illustrated }: Props) {
  const c = useHrCopy();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [invalidNames, setInvalidNames] = useState<string[]>([]);
  const [added, setAdded] = useState(0);

  function add(list: File[]) {
    if (disabled || list.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of list) {
      if (/\.(pdf|docx?)$/i.test(file.name) && file.size > 0 && file.size <= 5 * 1024 * 1024) accepted.push(file);
      else rejected.push(file.name);
    }
    if (accepted.length) setFiles(previous => [...previous, ...accepted]);
    setAdded(accepted.length);
    setInvalidNames(rejected);
  }

  return (
    <div className={s.picker} data-illustrated={illustrated || undefined} data-filled={files.length > 0}>
      <input ref={input} hidden type="file" multiple accept=".pdf,.doc,.docx" onChange={event => {
        add(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = '';
      }}/>
      <button type="button" className={s.drop} disabled={disabled} data-dragging={dragging} onClick={() => input.current?.click()}
        onDragOver={event => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragging(!disabled);
        }}
        onDragLeave={event => {
          const target = event.relatedTarget;
          if (!(target instanceof Node) || !event.currentTarget.contains(target)) setDragging(false);
        }}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          add(Array.from(event.dataTransfer.files));
        }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 18H6a4 4 0 0 1-.2-8 6.25 6.25 0 0 1 12.4 0 4 4 0 0 1-.2 8h-2m-4 2v-8m-3 3 3-3 3 3"/>
        </svg>
        <span className={s.prompt}>
          <strong>{c(dragging ? 'Lepas untuk menambahkan CV' : 'Tarik CV ke sini')}</strong>
          <small>{c('PDF, DOC, DOCX · Maksimal 5 MB per berkas')}</small>
        </span>
        <span className={s.action}>{c(files.length ? 'Tambah file' : 'Pilih file')}</span>
      </button>
      <p className={s.summary} role="status">
        <strong>{files.length ? `${files.length} ${c('CV dipilih')}` : c('Bisa pilih banyak CV sekaligus')}</strong>
        {files.length > 0 && added > 0 && <span>{added} {c('CV baru ditambahkan')}</span>}
      </p>
      {files.length > 0 && <>
        <ol className={s.files} aria-label={c('CV yang dipilih')} tabIndex={0}>
          {files.map((file, index) => <li key={`${index}-${file.name}`}>
            <span title={file.name}>{file.name}</span>
            <small>{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</small>
            <button type="button" aria-label={`${c('Hapus')} ${file.name}`} disabled={disabled} onClick={() => {
              setFiles(previous => previous.filter((_, position) => position !== index));
              setAdded(0);
            }}>×</button>
          </li>)}
        </ol>
        <p className={s.hint}>{c('Kamu bisa menambah CV dari folder lain. Upload dimulai setelah klik Lanjut.')}</p>
      </>}
      {invalidNames.length > 0 && <p role="alert" className={s.error} title={invalidNames.join(', ')}>
        {invalidNames.slice(0, 3).join(', ')}{invalidNames.length > 3 && ` (+${invalidNames.length - 3})`} — {c('gunakan PDF, DOC atau DOCX maksimal 5 MB.')}
      </p>}
    </div>
  );
}
