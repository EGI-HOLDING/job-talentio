'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell/PageHeader';
import { Alert, Badge, Card, Stat } from '@/components/ui/primitives';

type Counts={status:string;_count:{_all:number}}[];
type Endpoint={endpoint:string;appLimit:number;memberLimit:number;used:number|null;requests:number|null;success:number|null;httpErrors:number|null;transportErrors:number|null;rateLimited:number|null;averageMs:number|null;latency:Record<string,number>|null};
type Metrics={posts:Counts;connections:Counts;oldestQueuedAt:string|null;expiring:number;failures:{errorCode:string|null;_count:{_all:number}}[];daily:Counts;operations:{available:boolean;configurationValid:boolean;day:string;resetAt:string;endpoints:Endpoint[]};enabled:boolean;sharingEnabled:boolean;apiVersion:string;generatedAt:string};
const names:Record<string,string>={imageInitialize:'Initialize image',imageUpload:'Upload image',imageRead:'Check image',posts:'Publish post'};
const count=(rows:Counts,status:string)=>rows.find(row=>row.status===status)?._count._all ?? 0;
const number=(value:number|null)=>value===null?'Unavailable':value.toLocaleString('en');
const when=(value:string)=>new Date(value).toLocaleString();

export default function LinkedInOperationsPage(){
  const [data,setData]=useState<Metrics|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
    const load=async()=>{try{const value=await api<Metrics>('/admin/linkedin/metrics');if(alive){setData(value);setError('');}}catch(reason){if(alive)setError(reason instanceof Error?reason.message:'LinkedIn metrics could not be loaded');}finally{if(alive){setLoading(false);timer=setTimeout(()=>void load(),30000);}}};
    setLoading(true);void load();return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[revision]);
  const pressure=data?.operations.endpoints.filter(row=>row.used!==null&&row.used/row.appLimit>=.75) || [];
  return <>
    <PageHeader title="LinkedIn operations" subtitle="Personal HR sharing · aggregate health and internal daily request limits"/>
    <div className="content">
      <div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap',marginBottom:20}}><button type="button" className="secondary" disabled={loading} onClick={()=>setRevision(value=>value+1)}>Refresh</button>{data&&<span className="muted">Updated {when(data.generatedAt)} · auto refresh every 30 seconds</span>}</div>
      {loading&&!data&&<p role="status">Loading LinkedIn metrics…</p>}
      {error&&<Alert tone="error">{error}{data?' The figures below are from the last successful refresh.':''}</Alert>}
      {data&&<>
        <Card title="Release and delivery status"><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><Badge tone={data.enabled?'ok':'warn'}>OAuth {data.enabled?'enabled':'disabled'}</Badge><Badge tone={data.sharingEnabled?'ok':'warn'}>Sharing {data.sharingEnabled?'enabled':'paused'}</Badge><Badge>API {data.apiVersion}</Badge><Badge tone={data.operations.available?'ok':'warn'}>Queue telemetry {data.operations.available?'available':'unavailable'}</Badge></div><p className="muted">Activation requires a verified real LinkedIn canary. This dashboard does not prove provider access. It exposes no HR credentials or personal feed contents.</p></Card>
        {!data.operations.configurationValid&&<Alert tone="error">The internal quota configuration is invalid. Correct LINKEDIN_ENDPOINT_LIMITS before delivery resumes.</Alert>}
        {pressure.length>0&&<Alert tone="info">75% or more of the internal daily safety ceiling has been used: {pressure.map(row=>names[row.endpoint]).join(', ')}. Compare approved quotas in the LinkedIn Developer Portal before changing limits.</Alert>}
        <div className="grid"><Stat label="Queued" value={count(data.posts,'PENDING')} foot={data.oldestQueuedAt?'Oldest request: '+when(data.oldestQueuedAt):'No queued requests'}/><Stat label="In progress" value={['RENDERING','UPLOADING','PUBLISHING'].reduce((sum,status)=>sum+count(data.posts,status),0)}/><Stat label="Needs owner review" value={count(data.posts,'UNKNOWN')} attention={count(data.posts,'UNKNOWN')>0} foot="Never retry automatically"/><Stat label="Failed" value={count(data.posts,'FAILED')} attention={count(data.posts,'FAILED')>0}/></div>
        <div className="grid"><Stat label="Published" value={count(data.posts,'PUBLISHED')}/><Stat label="Connected HR accounts" value={count(data.connections,'CONNECTED')}/><Stat label="Expiring within 14 days" value={data.expiring} attention={data.expiring>0}/><Stat label="Expired or revoked" value={count(data.connections,'EXPIRED')+count(data.connections,'REVOKED')}/></div>
        <Card title="Daily request usage and latency"><p className="muted">UTC day {data.operations.day}; quota counters reset {when(data.operations.resetAt)}. These are internal ceilings, not LinkedIn's actual quotas. Counts include separate image and post calls. Latency buckets are cumulative. Unavailable telemetry is not zero usage.</p>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:880}}><thead><tr>{['Endpoint','Used / app ceiling','Member ceiling','HTTP success / attempts','429','Other errors','Mean ms','≤250ms / ≤1s / ≤5s / ≤20s'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.operations.endpoints.map(row=><tr key={row.endpoint}><th scope="row">{names[row.endpoint] || row.endpoint}</th><td>{number(row.used)} / {number(row.appLimit)}</td><td>{number(row.memberLimit)}</td><td>{number(row.success)} / {number(row.requests)}</td><td>{number(row.rateLimited)}</td><td>{row.httpErrors===null?'Unavailable':number(row.httpErrors-(row.rateLimited||0)+(row.transportErrors||0))}</td><td>{number(row.averageMs)}</td><td>{row.latency?[250,1000,5000,20000].map(max=>row.latency!['le'+max] || 0).join(' / '):'Unavailable'}</td></tr>)}</tbody></table></div>
          {!data.operations.available&&<p role="status">Telemetry is unavailable while delivery is paused or Redis cannot be reached. Database status counts above remain independent.</p>}
        </Card>
        <div className="grid"><Card title="Requests updated today"><ul>{data.daily.map(row=><li key={row.status}>{row.status}: {row._count._all}</li>)}</ul>{!data.daily.length&&<p>No requests updated today.</p>}</Card><Card title="Failure reasons"><ul>{data.failures.map(row=><li key={row.errorCode || 'none'}><code>{row.errorCode || 'UNSPECIFIED'}</code>: {row._count._all}</li>)}</ul>{!data.failures.length&&<p>No failed or uncertain requests.</p>}</Card></div>
        <Card title="Recovery"><p>UNKNOWN means a final request may have been accepted. Ask the connection owner to inspect their feed and use the job's reconciliation action after the cooldown. Do not force a queue retry or change its state in the database.</p><p>For expired or revoked connections, HR reconnects in Settings → Integrations and reviews a new preview. Existing LinkedIn posts are not removed when a connection is disconnected.</p><Link href="/audit">Open audit log</Link></Card>
      </>}
    </div>
  </>;
}
