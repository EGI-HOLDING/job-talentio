'use client';
import type { OccupationMatchingMetadata } from '@job-talentio/shared';
import { CatalogParentSelect } from './CatalogParentSelect';

export function OccupationMatchingEditor({value,onChange}:{value:OccupationMatchingMetadata;onChange:(value:OccupationMatchingMetadata)=>void}) {
  return <section style={{display:'grid',gap:12}}><h3>Occupation matching references</h3>
    <p><a href="/occupation-relations">View computed profession relations and corrections</a></p>
    <label>ESCO profession profile URI (optional)<input value={value.professionSourceUri||''} onChange={e=>onChange({...value,professionSourceUri:e.target.value||undefined,professionTaskProfile:e.target.value?value.professionTaskProfile:undefined})}/></label>
    {value.professionSourceUri && (value.professionTaskProfile
      ? <fieldset style={{display:'grid',gap:8}}>
          <legend>Local task profile</legend>
          <label>Core tasks and occupational scope<textarea value={value.professionTaskProfile.scope} onChange={e=>onChange({...value,professionTaskProfile:{...value.professionTaskProfile!,scope:e.target.value}})}/></label>
          <label>Evidence or source reference<input value={value.professionTaskProfile.evidence} onChange={e=>onChange({...value,professionTaskProfile:{...value.professionTaskProfile!,evidence:e.target.value}})}/></label>
          {value.professionTaskProfile.skillUris.map((uri,index)=><div key={index}>
            <label>ESCO skill URI {index+1}<input value={uri} onChange={e=>onChange({...value,professionTaskProfile:{...value.professionTaskProfile!,skillUris:value.professionTaskProfile!.skillUris.map((previous,i)=>i===index?e.target.value:previous)}})}/></label>
            <button type="button" onClick={()=>onChange({...value,professionTaskProfile:{...value.professionTaskProfile!,skillUris:value.professionTaskProfile!.skillUris.filter((_,i)=>i!==index)}})}>Remove skill</button>
          </div>)}
          <button type="button" disabled={value.professionTaskProfile.skillUris.length>=40} onClick={()=>onChange({...value,professionTaskProfile:{...value.professionTaskProfile!,skillUris:[...value.professionTaskProfile!.skillUris,'']}})}>Add reference skill</button>
          <button type="button" className="secondary" onClick={()=>onChange({...value,professionTaskProfile:undefined})}>Remove local task profile</button>
        </fieldset>
      : <button type="button" className="secondary" onClick={()=>onChange({...value,professionTaskProfile:{scope:'',evidence:'',skillUris:['']}})}>Describe a narrower local task profile</button>)}
    <p className="muted">Relations run from this canonical occupation to the selected target only. Reverse and chained relations are not inferred. Approve both occupations first and record the review reference. Matching recommendations show exact positions before approved related occupations; sharing a family alone is insufficient.</p>
    <label>ISCO-08 unit group (4 digits)<input value={value.isco08 ?? ''} maxLength={4} pattern="[0-9]{4}" onChange={e=>onChange({...value,isco08:e.target.value || undefined})}/></label>
    {(['id','uz'] as const).map(locale=><label key={locale}>{locale.toUpperCase()} label review<select value={value.labelReview?.[locale] ?? 'UNREVIEWED'} onChange={e=>onChange({...value,labelReview:{...value.labelReview,[locale]:e.target.value}})}><option value="UNREVIEWED">Needs local review</option><option value="LOCAL_STANDARD">Checked against local classification</option><option value="NATIVE_REVIEWED">Reviewed by a native speaker</option></select></label>)}
    <strong>Sources</strong>{value.sources.map((source,i)=><fieldset key={i} style={{display:'grid',gap:8}}>{(['provider','version','uri','code'] as const).map(field=><label key={field}>{field}<input value={source[field] ?? ''} onChange={e=>onChange({...value,sources:value.sources.map((s,n)=>n===i?{...s,[field]:e.target.value || undefined}:s)})}/></label>)}<button type="button" className="secondary" onClick={()=>onChange({...value,sources:value.sources.filter((_,n)=>n!==i)})}>Remove source</button></fieldset>)}
    <button type="button" className="secondary" disabled={value.sources.length>=10} onClick={()=>onChange({...value,sources:[...value.sources,{provider:'',version:''}]})}>Add source</button>
    <strong>Related occupations</strong>{value.relatedRoles.map((relation,i)=><fieldset key={i} style={{display:'grid',gap:8}}><CatalogParentSelect type="jobTitle" label="Related occupation" value={relation.id} onChange={id=>onChange({...value,relatedRoles:value.relatedRoles.map((r,n)=>n===i?{...r,id}:r)})}/><label>Evidence / source reference<input value={relation.reference} onChange={e=>onChange({...value,relatedRoles:value.relatedRoles.map((r,n)=>n===i?{...r,reference:e.target.value}:r)})}/></label><label><input type="checkbox" checked={relation.approved} onChange={e=>onChange({...value,relatedRoles:value.relatedRoles.map((r,n)=>n===i?{...r,approved:e.target.checked}:r)})}/> Approved for matching</label><button type="button" className="secondary" onClick={()=>onChange({...value,relatedRoles:value.relatedRoles.filter((_,n)=>n!==i)})}>Remove relation</button></fieldset>)}
    <button type="button" className="secondary" disabled={value.relatedRoles.length>=100} onClick={()=>onChange({...value,relatedRoles:[...value.relatedRoles,{id:'',kind:'RELATED',reference:'',approved:false}]})}>Add related occupation</button>
  </section>;
}
