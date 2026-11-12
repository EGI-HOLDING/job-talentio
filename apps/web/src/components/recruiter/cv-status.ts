'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

export type CvStatus = {
  id: string;
  revision?: number;
  scoreStatus: string;
  cvScore: number | null;
  cvProgress?: { phase: string; updatedAt: string } | null;
  error: string | null;
};
export const cvPending = (status: CvStatus) => ['PENDING', 'PROCESSING', 'UPLOADING'].includes(status.scoreStatus);

const phaseLabels: Record<string, string> = {
  READING: 'Sedang membaca CV', SCORING: 'Sedang dinilai', REPAIRING: 'Sedang memeriksa kembali bukti CV',
  DELAYED: 'Penilaian masih berjalan', RECOVERING: 'Penilaian sedang dipulihkan', DOCUMENT_REQUIRED: 'CV perlu diganti',
};
const legacyLabels: Record<string, string> = {
  STALE: 'Perlu dinilai ulang', UPLOADING: 'Mengupload', PENDING: 'Menunggu penilaian',
  PROCESSING: 'Sedang dinilai', FAILED: 'Perlu diperiksa', UNREADABLE: 'CV belum terbaca', EXTRACTED: 'Belum dipilih lowongan',
};
export function candidateScore(row: CvStatus) {
  if (row.cvScore !== null) return `${row.cvScore}%`;
  return phaseLabels[row.cvProgress?.phase ?? ''] ?? legacyLabels[row.scoreStatus] ?? 'Belum tersedia';
}

export function useCvStatus(companyId: string, ids: string, onStatus: (rows: CvStatus[]) => void) {
  const latest = useRef(onStatus);
  latest.current = onStatus;
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    const url = '/recruitment/companies/' + encodeURIComponent(companyId) + '/cv-status?' + new URLSearchParams({ ids });
    let timer: ReturnType<typeof setTimeout>, checking = false;
    const check = async () => {
      if (document.hidden || checking || controller.signal.aborted) return;
      checking = true;
      try {
        const rows = await api<CvStatus[]>(url, { cacheMode: 'no-store', signal: controller.signal });
        if (!controller.signal.aborted) latest.current(rows);
      } catch { /* The next scheduled read can recover. */ }
      finally {
        checking = false;
        if (!controller.signal.aborted && !document.hidden) timer = setTimeout(check, 5000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void check();
    };
    timer = setTimeout(check, 5000);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [companyId, ids]);
}
