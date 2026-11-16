'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { localeUrl } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { activeLinkedInPost, connectLinkedIn, linkedInActionError, type LinkedInPreview } from '@/lib/linkedin';
import { LinkedInPostStatus, useLinkedInPosts } from './LinkedInPostStatus';
import s from './LinkedInSharePreview.module.css';

type Page = {urn: string; name: string};
type Connection = {available: boolean; simulated: boolean; connected: boolean; page: Page | null};

export function CompanyLinkedInShare({companyId, jobId}: {companyId: string; jobId: string}) {
  const {locale, t} = useI18n();
  const id = useId();
  const path = '/integrations/linkedin/companies/' + encodeURIComponent(companyId);
  const jobPath = '/jobs/' + encodeURIComponent(jobId);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<LinkedInPreview | null>(null);
  const [retryPost, setRetryPost] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const {posts, reload, error: postError} = useLinkedInPosts(jobId);
  const post = posts[0];
  const locked = post && (activeLinkedInPost(post) || ['PUBLISHED','UNKNOWN'].includes(post.status));
  const label = (indonesian: string, english: string) => locale === 'id' ? indonesian : english;

  useEffect(() => {
    const abort = new AbortController();
    setPreview(null);
    setPages(null);
    setConnection(null);
    setError('');
    api<Connection>(path, {signal: abort.signal, cacheMode: 'no-store'}).then(value => {
      if (!abort.signal.aborted) { setConnection(value); setSelected(value.page?.urn ?? ''); }
    }).catch(reason => { if (!abort.signal.aborted) setError(linkedInActionError(reason,t)); });
    return () => abort.abort();
  }, [path, refresh, t]);

  async function run(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (reason) { setError(linkedInActionError(reason,t)); }
    finally { pending.current = false; setBusy(false); }
  }

  async function prepare(postId?: string) {
    await run(async () => {
      const value = await api<LinkedInPreview>(jobPath + '/linkedin/preview', {method:'POST',body:JSON.stringify({locale})});
      setPreview(value);
      setRetryPost(postId ?? null);
    });
  }

  async function selectPage() {
    if (!selected || !connection) return;
    await run(async () => {
      const page = await api<Page>(path + '/page', {method:'PATCH',body:JSON.stringify({urn:selected})});
      setConnection({...connection, page});
      setPages(null);
      setPreview(null);
    });
  }

  return <section id="linkedin-share-title" className={s.panel} aria-labelledby={id} aria-busy={busy || undefined}>
    <div className={s.panelHeading}><span className={s.brandMark} aria-hidden="true">in</span><div className={s.headingText}>
      <h3 id={id}>{label('Posting ke halaman perusahaan LinkedIn','Post to the company LinkedIn page')}</h3>
      {connection?.page && <p>{connection.page.name}</p>}
    </div>{connection?.simulated && <span className={s.connectionStatus}>{label('Simulasi lokal','Local simulation')}</span>}</div>
    {error && <p className={s.error} role="alert">{error} {!connection && <button type="button" className={s.linkButton} onClick={() => setRefresh(x => x+1)}>{t('workspace.retry')}</button>}</p>}
    {postError && <p className={s.error} role="alert">{postError} <button type="button" className={s.linkButton} onClick={reload}>{t('workspace.retry')}</button></p>}
    {post && <LinkedInPostStatus post={post} onReload={reload} onRetry={postId => void prepare(postId)}
      companyPage={{id: connection?.page?.urn.split(':').pop(), simulated: connection?.simulated !== false}}/>}
    {connection && !connection.available && <p role="status" className={s.notice}>{t('li.serviceUnavailable')}</p>}
    {!locked && connection?.available && <div>
      {!connection.connected || (post && post.errorCode === 'ACCESS_REVOKED') ? <button type="button" disabled={busy} className={s.secondaryButton}
        onClick={() => void run(() => connectLinkedIn(localeUrl(locale,employerJobHref(jobId,'details',companyId)), companyId))}>
        {label('Hubungkan LinkedIn','Connect LinkedIn')}
      </button> : <>
        {pages === null && <button type="button" disabled={busy} className={s.secondaryButton}
          onClick={() => void run(async () => setPages(await api<Page[]>(path+'/pages',{cacheMode:'no-store'})))}>
          {connection.page ? label('Ganti halaman','Change page') : label('Pilih halaman perusahaan','Select a company page')}
        </button>}
        {pages && (pages.length ? <div className={s.shareChoice}>
          <label htmlFor={id+'-page'}>{label('Halaman perusahaan','Company page')}</label>
          <select id={id+'-page'} value={selected} disabled={busy} onChange={event => {setSelected(event.target.value);setPreview(null);}}>
            <option value="">{label('Pilih halaman','Select a page')}</option>
            {pages.map(page => <option key={page.urn} value={page.urn}>{page.name}</option>)}
          </select>
          <button type="button" className={s.secondaryButton} disabled={busy || !selected} onClick={() => void selectPage()}>{label('Simpan halaman','Save page')}</button>
        </div> : <p className={s.notice}>{label('Akun LinkedIn ini belum memiliki akses posting ke halaman perusahaan.','This LinkedIn account cannot post to a company page.')}</p>)}
        {connection.page && pages === null && (!post || post.retrySafe) && <button type="button" disabled={busy} className={s.secondaryButton}
          onClick={() => void prepare(post?.id)}>{t('li.previewTitle')}</button>}
      </>}
    </div>}
    {preview && !locked && <div className={s.previewSection}>
      <h4>{label('Preview posting','Post preview')} &#xb7; {preview.displayName}</h4>
      <div className={s.previewGrid}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={s.approvedPoster} src={preview.posterDataUrl} alt={t('li.posterPreview')}/>
        <div className={s.captionCard}><p>{preview.caption}</p></div>
      </div>
      <button type="button" className={s.primaryButton} disabled={busy} onClick={() => void run(async () => {
        await api(retryPost ? '/social-posts/'+encodeURIComponent(retryPost)+'/retry' : jobPath+'/social-posts',
          {method:'POST',body:JSON.stringify({previewId:preview.id})});
        setPreview(null);
        reload();
      })}>{label('Setujui dan posting','Approve and post')}</button>
    </div>}
  </section>;
}
