'use client';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n';
import s from './TaraPreparation.module.css';
export type Preparation = { status: 'WAITING_CV' | 'PROCESSING' | 'READY' | 'FAILED'; planId: string | null; reason: string | null };
export function TaraRunner({ hero = false, progress, small = false }: { hero?: boolean; progress?: number; small?: boolean }) {
    const { t } = useI18n();
    const value = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
    const position = value === undefined ? undefined : { left: value + '%', transform: `translateX(-${value}%)` } as CSSProperties;
    return <div className={`${s.track} ${hero ? s.heroTrack : ''} ${small ? s.smallTrack : ''}`} role={value === undefined ? undefined : 'progressbar'} aria-label={value === undefined ? undefined : t('uploading')} aria-valuenow={value} aria-valuemin={value === undefined ? undefined : 0} aria-valuemax={value === undefined ? undefined : 100} aria-hidden={value === undefined ? true : undefined} data-tara-track>
        <span className={s.highlightClip} aria-hidden="true" data-tara-highlight-clip>
            <span className={s.highlightPosition} data-determinate={value !== undefined} style={position}>
                <span className={s.highlight} data-tara-highlight/>
            </span>
        </span>
        <span aria-hidden="true" className={s.runner} data-determinate={value !== undefined} style={position}>
            <span className={s.sprite} data-tara="runner"/>
        </span>
    </div>;
}
export function TaraPreparation({ preparation, variant = 'compact', rules = false, casual = false, onRetry, onChangeCv, busy = false, invited = false }: {
    preparation: Preparation; invited?: boolean; variant?: 'compact' | 'waiting'; rules?: boolean; casual?: boolean; onRetry: () => void; onChangeCv: () => void; busy?: boolean;
}) {
    const failed = preparation.status === 'FAILED', ready = preparation.status === 'READY', waiting = variant === 'waiting';
    const recovery = preparation.reason === 'RECOVERY_REQUIRED', unreadable = preparation.reason === 'CV_UNREADABLE';
    const title = failed ? unreadable ? 'Tonjolkan ceritamu lewat CV yang terbaca, yuk' : recovery ? 'Obrolanmu perlu disambungkan kembali' : 'Tara lagi mengalami kendala' : ready ? 'Tara sudah siap ngobrol!' : 'Tara sedang menyiapkan kejutan';
    const description = invited ? failed ? recovery ? 'Progresmu tersimpan. Tim kami perlu memeriksa sambungannya.' : unreadable ? 'CV dari undangan ini belum dapat dibaca. Hubungi HR untuk memperbarui berkasnya.' : 'Progresmu aman. Coba sambungkan kembali, ya.' : ready ? 'Tara sudah siap. Lanjut saat kamu siap.' : 'Tara sedang menyiapkan pertanyaan dari CV dan lowongan. Waktu menjawab belum dimulai.' : failed ? unreadable ? 'CV ini belum bisa dibaca. Pilih atau unggah PDF atau DOCX dengan teks yang jelas, ya.' : recovery ? 'Progresmu tersimpan. Tim kami perlu memeriksa sambungannya; kamu bisa kembali lagi nanti.' : 'Progresmu aman. Coba lanjutkan lagi, ya.' : casual ? ready ? 'Gue udah siap. Lanjut kalau lu juga udah siap, ya.' : waiting ? 'Gue lagi nyiapin obrolan dari CV lu. Santai dulu, sebentar lagi kita mulai!' : rules ? 'Lu tetap bisa klik mulai, ya.' : 'Lu bisa lanjut sambil ngisi cover letter.' : ready ? 'Lanjutkan saat kamu sudah siap, ya.' : waiting ? 'Aku lagi merangkai pertanyaan dari CV-mu. Santai dulu, ya. Sebentar lagi kita ngobrol!' : rules ? 'Kamu tetap bisa klik mulai, ya.' : 'Kamu bisa lanjut sambil mengisi cover letter.';
    return <div className={`${s.preparation} ${waiting ? s.waiting : s.compact}`} data-preparation={preparation.status}>
        {waiting && !failed && !ready && <TaraRunner hero/>}
        <div className={s.copy}><div role="status" aria-live="polite" aria-atomic="true">{waiting ? <h2 tabIndex={-1}>{title}</h2> : <strong>{ready ? '✓ ' : failed ? '' : '✦ '}{title}</strong>}<p>{description}</p></div>
        {failed && <div className={s.actions}>{unreadable ? <button type="button" onClick={onChangeCv}>{invited ? 'Hubungi HR' : 'Ganti CV'}</button> : !recovery && <button type="button" disabled={busy} onClick={onRetry}>{busy ? 'Menyambungkan\u2026' : 'Coba lagi'}</button>}</div>}
        </div>
        {!waiting && !failed && !ready && <TaraRunner/>}
        {waiting && !failed && <><span className={s.dots} aria-hidden="true"><i/><i/><i/></span><p className={s.timer}>◷ Waktu menjawab belum dimulai</p><p className={s.automatic}>Kamu akan masuk otomatis saat pertanyaannya siap.</p></>}
    </div>;
}
export function TaraThinking({ casual = false }: { casual?: boolean }) {
    return <div className={s.thinking} data-testid="tara-thinking"><Image src="/images/tara/thinking.png" width={56} height={56} alt="" data-tara="thinking"/><div className={s.bubble}><span className={s.dots} aria-hidden="true"><i/><i/><i/></span><p>{casual ? 'Bentar, gue lagi nyambungin cerita lu\u2026' : 'Sebentar ya, aku lagi menyusun pertanyaan berikutnya\u2026'}</p><TaraRunner/><small>ⓘ Waktu menjawab mulai saat pertanyaan tampil.</small></div></div>;
}
