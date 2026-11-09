'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect,useState } from 'react';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import type { Evidence,ScreeningEvaluation,Report } from './screening-view';
import s from './ScreeningPanel.module.css';
export type { ScreeningEvaluation } from './screening-view';
export function ScreeningResult({result,claims,questions=[],onEvidence,focusClaim}:{result:ScreeningEvaluation;claims:Array<{id:string;statement:string;quote:string}>;questions?:Report['questions'];onEvidence?:(claimId:string,evidence:Evidence)=>void;focusClaim?:string}){
 const uiCopy=useHrCopy();
 const [expanded,setExpanded]=useState(result.claims?.[0]?.claimId??'');
 useEffect(()=>{if(focusClaim)setExpanded(focusClaim);},[focusClaim]);
 return <div className={s.results}>
 <section><h4>Ringkasan</h4><p>{result.summary||'Belum ada ringkasan yang tersedia.'}</p></section>
 <div className={s.findings}><section><h4 className={s.inlineTitle}><WorkspaceIcon kind="layers"/>{uiCopy("Penjelasan yang didukung")}</h4>{result.strengths?.length?<ul>{result.strengths.map((v,i)=><li key={i}>{v}</li>)}</ul>:<p className={s.muted}>Belum ada penjelasan yang cukup untuk dirangkum.</p>}</section><section><h4 className={s.inlineTitle}><WorkspaceIcon kind="info"/>{uiCopy("Perlu didalami")}</h4>{result.gaps?.length?<ul>{result.gaps.map((v,i)=><li key={i}>{v}</li>)}</ul>:<p className={s.muted}>Tidak ada catatan tambahan dari evaluator.</p>}</section></div>
 <section><div className={s.sectionTitle}><h4>{uiCopy("Klaim yang diperiksa")}</h4>{result.voice&&<small>{result.voice.testedClaims} diuji &#xb7; {result.voice.totalClaims-result.voice.testedClaims} belum diuji</small>}</div>
 <div className={s.claimList}>{result.claims?.map((claim,i)=>{const source=claims.find(c=>c.id===claim.claimId);return <details key={claim.claimId} data-claim={claim.claimId} open={expanded===claim.claimId} onToggle={e=>{if(e.currentTarget.open)setExpanded(claim.claimId);}}>
 <summary onClick={e=>{e.preventDefault();setExpanded(expanded===claim.claimId?'':claim.claimId);}}><span className={s.index}>{i+1}</span><strong>{source?.statement??'Klaim '+(i+1)}</strong><span className={s.claimScore}>{claim.asked===false?'Belum diuji':claim.score==null?'Perlu ditinjau':`${claim.score}/4 \u00b7 ${claim.score>=3?'Didukung':claim.score===0?'Bukti belum memadai':'Perlu pendalaman'}`}</span><span aria-hidden="true">{expanded===claim.claimId?'⌃':'⌄'}</span></summary>
 <div className={s.claimBody}>{source?.quote&&<div className={s.evidence}><span>{uiCopy("Dalam CV")}</span><p>{source.quote}</p></div>}
 {claim.evidence?.map((e,n)=>{const q=e.questionText??questions.find(q=>q.id===e.questionId)?.text;return <div key={n} className={s.evidenceGroup}>{q&&<div className={s.evidence}><span>{uiCopy("Pertanyaan Tara")}</span><p>{q}</p></div>}<div className={s.evidence}><span>{uiCopy("Jawaban kandidat")}</span><p>{e.quote}{e.quote.length>=500&&<small> &#xb7; Kutipan disingkat; buka konteks untuk jawaban lengkap.</small>}</p></div>{onEvidence&&<button type="button" className={s.link} onClick={()=>onEvidence(claim.claimId,e)}>Lihat konteks percakapan →</button>}</div>;})}
 {claim.asked===false&&<p className={s.muted}>Belum sempat diuji; tidak diberi nilai nol.</p>}<p className={s.reason}>{claim.reason}</p>
 {claim.contradictions?.map((p,i)=><div key={i} className={s.warning}><strong>{uiCopy("Perlu konfirmasi HR")}</strong><p>{p.left.quote}</p><p>{p.right.quote}</p></div>)}
 </div></details>;})}</div></section>
 {!!result.interviewQuestions?.length&&<section><h4>{uiCopy("Pertanyaan lanjutan untuk HR")}</h4><ol className={s.nextQuestions}>{result.interviewQuestions.map((q,i)=><li key={i}><span className={s.index}>{i+1}</span>{q}</li>)}</ol></section>}
 </div>;
}
