'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { connectLinkedIn, linkedInActionError, type LinkedInConnection } from '@/lib/linkedin';
import { Link } from '@/lib/navigation';
import { accountReturnHref } from '@/lib/accountNavigation';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import s from './LinkedInIntegrationPanel.module.css';

export function LinkedInIntegrationPanel() {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [message, setMessage] = useState('');
  const [data,setData]=useState<LinkedInConnection|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const [returnTo,setReturnTo]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;setLoading(true);setError('');
    const url=new URL(window.location.href),result=url.searchParams.get('linkedin');
    setReturnTo(accountReturnHref('RECRUITER',url.searchParams.get('returnTo')));
    if(result){setMessage(t(result==='connected'?'li.connectedResult':result==='denied'?'li.deniedResult':'li.failedResult'));url.searchParams.delete('linkedin');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}
    api<LinkedInConnection>('/integrations/linkedin').then(value=>{if(alive)setData(value);}).catch(()=>{if(alive)setError(t('li.loadFailed'));}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[locale,retry,t]);
  async function connect(){if(busy)return;setBusy(true);setError('');try{await connectLinkedIn(window.location.pathname+window.location.search+window.location.hash);}catch(reason){setError(linkedInActionError(reason,t));setBusy(false);}}
  async function disconnect(){if(busy||!await confirm({title:t('li.disconnect'),message:t('li.disconnectHint'),confirmLabel:t('li.disconnect'),tone:'danger'}))return;setBusy(true);setError('');try{setData(await api<LinkedInConnection>('/integrations/linkedin',{method:'DELETE'}));setMessage('');}catch(reason){setError(linkedInActionError(reason,t));}finally{setBusy(false);}}
  async function preference(enabled:boolean){if(busy)return;setBusy(true);setError('');try{setData(await api<LinkedInConnection>('/integrations/linkedin',{method:'PATCH',body:JSON.stringify({autoShareEnabled:enabled})}));}catch(reason){setError(linkedInActionError(reason,t));}finally{setBusy(false);}}

  return (
    <div className={s.panel}>
      <div className={s.intro}>
        <h2>{t('li.settingsTitle')}</h2>
        <p>{t('li.settingsHint')}</p>
      </div>

      {loading && <p role="status">{t('li.loadingConnection')}</p>}
      {error && <div className={s.feedback} role="alert">{error} <button type="button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>{t('workspace.retry')}</button></div>}
      {!loading && data && <section className={s.connectionCard} aria-labelledby="linkedin-integration-title" aria-busy={busy}>
        <div className={s.identity}>
          {data.avatarUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={data.avatarUrl} className={s.avatar} alt="" referrerPolicy="no-referrer"/> : <span className={s.brandMark} aria-hidden="true">in</span>}
          <div>
            <h3 id="linkedin-integration-title">{data.displayName || 'LinkedIn'}</h3>
            <p>{t('li.personalProfile')}</p>
          </div>
        </div>
        <span className={s.status} data-status={data.status}>{t('li.connection.'+data.status)}</span>
        <button
          type="button"
          className={s.connectButton}
          disabled={busy || !data.enabled}
          onClick={()=>void connect()}
        >
          {t(data.status==='DISCONNECTED'?'li.connect':'li.reconnect')}
        </button>
        {data.status!=='DISCONNECTED' && <button type="button" className={s.disconnect} disabled={busy} onClick={()=>void disconnect()}>{t('li.disconnect')}</button>}
        {data.expiresAt && <p className={s.feedback}>{t('li.expiry')}: {new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(data.expiresAt))}</p>}
        {!data.sharingEnabled && <p className={s.feedback} role="status">{t('li.serviceUnavailable')}</p>}
        {message && <p className={s.feedback} role="status">{message}</p>}
      </section>}
      {data && <label className={s.preference}><input type="checkbox" checked={data.autoShareEnabled} disabled={busy || !data.connected || !data.sharingEnabled} onChange={event=>void preference(event.target.checked)}/><span><strong>{t('li.defaultShare')}</strong><small>{t('li.defaultShareHint')}</small></span></label>}
      {returnTo && <Link className={s.returnLink} href={returnTo}>{t('li.returnReview')}</Link>}

      <section className={s.explanation}>
        <h3>{t('li.howItWorksTitle')}</h3>
        <ul>
          <li>{t('li.consentInfo')}</li>
          <li>{t('li.feedOnly')}</li>
          <li>{t('li.previewBeforeShare')}</li>
        </ul>
      </section>
    </div>
  );
}
