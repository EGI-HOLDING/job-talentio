'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { JOB_LANGUAGE_LIMIT, JOB_SKILL_LIMIT, LANGUAGE_LEVELS, normalizeSkillKey, SKILL_NAME_MAX_LENGTH, type JobContentAiLanguage } from '@job-talentio/shared';
import { CatalogPositionPicker, usePositionLabels } from '@/components/ui/CatalogPositionPicker';
import { LocationFields } from '@/components/ui/LocationFields';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import s from './HrFlow.module.css';
import { HrAddItemButton } from './HrFlowPresentation';
import { JobPositionGroupScope } from './JobPositionGroupScope';
import { JobContentAiButton, JobContentAiHelp, JobContentAiLanguageButton, JobContentAiLanguageDialog, JobContentAiPreview, type JobContentAiSkill, type JobContentAiSuggestion, type JobContentAiTarget } from './JobContentAi';

import { cleanHrDraft, type HrDraft, type HrDraftIssue } from './hrDraftValidation';
export { cleanHrDraft, type HrDraft } from './hrDraftValidation';
export const initialHrDraft=(job?:any):HrDraft=>job?{
  title:job.title,description:job.description,positionEntryMode:job.positionGroupId?'GROUP':job.positionEntryMode==='MANUAL'||!job.jobTitleId?'MANUAL':'CATALOG',jobTitleId:job.jobTitleId,
  jobContentAiLanguage:job.jobContentAiLanguage??undefined,
  positionGroupId:job.positionGroupId,positionGroupScopeRevision:job.positionGroupScopeRevision,
  seniorityLevelCode:job.seniorityLevelCode??null,experienceRangeMin:job.experienceRangeMin??job.seniorityYearsMin??null,experienceRangeMax:job.experienceRangeSource?job.experienceRangeMax:job.seniorityYearsMax??null,
  responsibilities:job.responsibilities??[],kpis:job.kpis??[],specificExpectations:job.specificExpectations??'',
  countryId:job.countryId??job.city?.province?.countryId??null,citySlug:job.city?.slug??'',workMode:job.workMode,employmentType:job.employmentType,
  salaryMin:job.salaryMin,salaryMax:job.salaryMax,currency:job.currency,salaryPeriod:job.salaryPeriod,
  skills:(job.jobSkills??[]).map((row:any)=>({slug:row.skill.slug,name:row.skill.name,isRequired:row.isRequired,minLevel:row.minLevel,weight:row.weight})),
  languages:(job.jobLanguages??[]).map((row:any)=>({code:row.language.code,name:row.language.name,minLevel:row.minLevel,isRequired:row.isRequired,confirmed:row.provenance==='EMPLOYER_CONFIRMED'})),
  benefits:(job.benefits??[]).map((row:any)=>({slug:row.benefit?.slug,name:row.benefit?.name})).filter((row:any)=>row.name),
}:{title:'',description:'',positionEntryMode:'MANUAL',jobTitleId:null,seniorityLevelCode:null,responsibilities:[],kpis:[],specificExpectations:'',countryId:null,citySlug:'',workMode:'ONSITE',employmentType:'FULL_TIME',salaryMin:null,salaryMax:null,currency:'IDR',salaryPeriod:'MONTHLY',skills:[],languages:[],benefits:[]};

type Level={code:string;name:string;nameId:string;yearsMin:number;yearsMax:number|null};
const chooseJobContentAiLanguage = process.env.NEXT_PUBLIC_PRIVACY_MARKET !== 'uz';

export function JobFormV2({draft,onChange,companyId,initialCity,approvedMembers,disabled=false,validationIssues=[]}:{draft:HrDraft;onChange:(patch:HrDraft)=>void;companyId:string;initialCity?:any;approvedMembers?:Array<{jobTitleId:string}>;disabled?:boolean;validationIssues?:HrDraftIssue[]}){
  const c=useHrCopy();
  const [manualTitle, setManualTitle] = useState<boolean | null>(null);
  const editingManualTitle = manualTitle ?? (draft.positionEntryMode === 'MANUAL' && Boolean(draft.title));
  const groupId=draft.positionEntryMode==='GROUP'?draft.positionGroupId:undefined;
  const catalogTitle = usePositionLabels(!editingManualTitle && draft.jobTitleId ? 'ROLE:' + draft.jobTitleId : '')?.[0]?.name;
  const clearedGroup={positionGroupId:null,positionGroupScopeRevision:null};
  const fieldErrors=(field:string)=>validationIssues.filter(issue=>issue.field===field).map(issue=><p className={s.error} role="alert" key={issue.path}>{c(issue.message)}</p>);
  const descriptionId=useId();
  const aiRequest=useRef<AbortController|null>(null);
  const [aiLanguageDialog,setAiLanguageDialog]=useState<JobContentAiTarget|'change'|null>(null);
  const aiLanguage=chooseJobContentAiLanguage?draft.jobContentAiLanguage:undefined;
  const [aiBusy,setAiBusy]=useState<JobContentAiTarget|null>(null),[aiError,setAiError]=useState<{target:JobContentAiTarget;message:string}|null>(null),[aiPreview,setAiPreview]=useState<{target:JobContentAiTarget;suggestion:JobContentAiSuggestion}|null>(null);
  const [addingLanguage,setAddingLanguage]=useState(false),[addingBenefit,setAddingBenefit]=useState(false),[currencies,setCurrencies]=useState<string[]>(['IDR','USD','EUR']);
  const languagePicker=useRef<HTMLDivElement>(null);
  const [skillKeys,setSkillKeys]=useState<number[]>(()=> (draft.skills ?? []).map((_: unknown,index: number)=>index));
  const nextSkillKey=useRef(skillKeys.length);
  const [focusSkill,setFocusSkill]=useState<number | null>(null);
  const [selectedAiSkills,setSelectedAiSkills]=useState<string[]>([]);
  const skillsTable=useRef<HTMLTableElement>(null);
  useEffect(()=>()=>aiRequest.current?.abort(),[]);
  useEffect(()=>{
    if(focusSkill===null)return;
    skillsTable.current?.querySelector<HTMLInputElement>('[data-skill-key="'+focusSkill+'"]')?.focus();
    setFocusSkill(null);
  },[focusSkill]);
  useEffect(()=>{if(addingLanguage)languagePicker.current?.querySelector('input')?.focus();},[addingLanguage]);
  useEffect(()=>{const abort=new AbortController();api<Array<{currencyCode?:string}>>('/meta/countries',{auth:false,signal:abort.signal}).then(rows=>setCurrencies([...new Set(['IDR','USD','EUR',...rows.map(row=>row.currencyCode).filter((value):value is string=>Boolean(value))])].sort())).catch(()=>undefined);return()=>abort.abort();},[]);
  const {locale,t}=useI18n();const confirm=useConfirm();
  const [levels,setLevels]=useState<Level[]>([]),[catalogError,setCatalogError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const abort=new AbortController();api<{levels:Level[]}>('/meta/seniority-levels',{auth:false,signal:abort.signal}).then(v=>{setLevels(v.levels);setCatalogError('');}).catch(error=>{if(!abort.signal.aborted)setCatalogError(error.message);});return()=>abort.abort();},[retry]);
  const update=(key:string,value:any)=>onChange({[key]:value});
  const aiLabels:Record<JobContentAiTarget,string>={description:c('Deskripsi posisi'),responsibilities:c('Tanggung jawab utama'),kpis:c('KPI posisi'),skills:c('Keahlian')};
  const aiFeedback=(target:JobContentAiTarget)=><>{aiBusy===target&&<p className={s.aiFeedback} role="status">{c("AI sedang menyusun saran...")}</p>}{aiError?.target===target&&<p className={s.aiFeedbackError} role="alert">{aiError.message}</p>}</>;
  function requestAiSuggestion(target:JobContentAiTarget){
    if(disabled||aiRequest.current||aiLanguageDialog||!draft.title?.trim())return;
    if(chooseJobContentAiLanguage&&!aiLanguage){setAiLanguageDialog(target);return;}
    void generateWithAi(target,aiLanguage);
  }
  function confirmAiLanguage(language:JobContentAiLanguage){
    if(!aiLanguageDialog||disabled||aiRequest.current)return;
    setAiLanguageDialog(null);
    if(language!==aiLanguage)onChange({jobContentAiLanguage:language});
    if(aiLanguageDialog!=='change')void generateWithAi(aiLanguageDialog,language);
  }
  async function generateWithAi(target:JobContentAiTarget,outputLanguage?:JobContentAiLanguage){
    if(disabled||aiRequest.current||!draft.title?.trim())return;
    const request=new AbortController();
    aiRequest.current=request;
    setAiBusy(target);setAiError(null);
    const level=levels.find(item=>item.code===draft.seniorityLevelCode);
    try{
      const result=await api<{target:JobContentAiTarget;suggestion:JobContentAiSuggestion;promptVersion:string}>('/job-content-ai/generate',{method:'POST',signal:request.signal,body:JSON.stringify({
        companyId,target,locale,outputLanguage,job:{
          title:draft.title,
          seniority:level?((outputLanguage??locale)==='id'?(level.nameId??level.name):level.name):null,
          experienceMin:draft.experienceRangeMin??null,
          experienceMax:draft.experienceRangeMax??null,
          description:draft.description??'',
          responsibilities:draft.responsibilities??[],
          kpis:draft.kpis??[],
          specificExpectations:draft.specificExpectations??'',
          skills:(draft.skills??[]).filter((skill:any)=>skill.name?.trim()).map((skill:any)=>({name:skill.name.trim(),isRequired:skill.isRequired!==false,minLevel:skill.minLevel??null})),
        },
      })});
      if(request.signal.aborted)return;
      if(result.target!==target)throw Error(c('Hasil AI tidak sesuai dengan bagian yang dipilih. Silakan coba lagi.'));
      if(target==='skills'&&'items' in result.suggestion){
        const options=(result.suggestion.items as JobContentAiSkill[]).map(skill=>normalizeSkillKey(skill.name));
        setSelectedAiSkills([...new Set(options.filter(key=>!skillNames.has(key)))].slice(0,skillCapacity));
      }
      setAiPreview({target,suggestion:result.suggestion});
    }catch(error){if(!request.signal.aborted)setAiError({target,message:error instanceof Error?error.message:c('AI belum tersedia. Coba lagi sebentar.')});}
    finally{aiRequest.current=null;if(!request.signal.aborted)setAiBusy(null);}
  }
  function applyAiSuggestion(){
    if(!aiPreview)return;
    const {target,suggestion}=aiPreview;
    if(target==='description'&&'description'in suggestion)update('description',suggestion.description);
    if(target==='responsibilities'&&'items'in suggestion)update('responsibilities',(suggestion as {items:string[]}).items);
    if(target==='kpis'&&'items'in suggestion)update('kpis',(suggestion as {items:string[]}).items);
    if(target==='skills'&&'items'in suggestion){
      const seen=new Set(skillNames);
      const additions=(suggestion.items as JobContentAiSkill[]).filter(skill=>{
        const key=normalizeSkillKey(skill.name);
        if(seen.has(key)||!selectedAiSkills.includes(key))return false;
        seen.add(key);
        return true;
      }).slice(0,skillCapacity);
      if(additions.length)appendSkills(additions.map(skill=>({...skill,weight:1})));
    }
    setAiPreview(null);setAiError(null);
  }
  const list=(key:'responsibilities'|'kpis',label:string,target:'responsibilities'|'kpis')=>{
    const rows:string[]=draft[key]??[];
    return <div data-job-field={key}>{fieldErrors(key)}<div className={s.aiFieldHeading}><div className={s.label}>{label}</div><JobContentAiButton label={label} disabled={Boolean(aiBusy)||!draft.title?.trim()} loading={aiBusy===target} onClick={()=>requestAiSuggestion(target)}/></div>{aiFeedback(target)}<div className={s.list} style={{marginTop:12}}>{rows.map((value,index)=><div className={s.line} key={index}><input className={s.control} aria-label={`${label} ${index+1}`} value={value} maxLength={1000} onChange={e=>update(key,rows.map((v,i)=>i===index?e.target.value:v))}/><button className={s.icon} type="button" aria-label={`Hapus ${label} ${index+1}`} onClick={()=>update(key,rows.filter((_,i)=>i!==index))}>×</button></div>)}</div><HrAddItemButton disabled={rows.length>=30} onClick={()=>update(key,[...rows,''])}>{c("Tambah")} {key==='kpis'?label:label.toLowerCase()}</HrAddItemButton></div>;
  };
  async function chooseLevel(code:string){
    const previous=levels.find(v=>v.code===draft.seniorityLevelCode);
    const adjusted=draft.seniorityLevelCode&&(draft.experienceRangeMin!==previous?.yearsMin||draft.experienceRangeMax!==previous?.yearsMax);
    if(adjusted&&!await confirm({title:c("Ganti senioritas?"),message:c("Rentang pengalaman yang telah disesuaikan akan diganti dengan rentang otomatis untuk pilihan baru."),confirmLabel:c("Ganti senioritas")}))return;
    const level=levels.find(v=>v.code===code);
    onChange({seniorityLevelCode:code||null,experienceRangeMin:level?.yearsMin??null,experienceRangeMax:level?.yearsMax??null});
  }
  const skills:any[]=draft.skills??[],languages:any[]=draft.languages??[],benefits:any[]=draft.benefits??[];
  const skillNames=new Set<string>(skills.map(skill=>normalizeSkillKey(skill.name ?? skill.slug ?? '')));
  const skillCapacity=Math.max(0,JOB_SKILL_LIMIT-skills.length);
  function appendSkills(items: Array<JobContentAiSkill & { weight: number }>, focus=false){
    const ids=items.map(()=>nextSkillKey.current++);
    setSkillKeys(keys=>[...keys,...ids]);
    update('skills',[...skills,...items]);
    if(focus)setFocusSkill(ids[0]);
  }
  function updateSkill(index:number, patch:Record<string,unknown>){
    update('skills',skills.map((skill,i)=>i===index?{...skill,...patch}:skill));
  }
  function removeSkill(index:number){
    setSkillKeys(keys=>keys.filter((_,i)=>i!==index));
    update('skills',skills.filter((_,i)=>i!==index));
  }
  const rangeInvalid=draft.seniorityLevelCode&&(draft.experienceRangeMin==null||draft.experienceRangeMax!=null&&draft.experienceRangeMax<draft.experienceRangeMin);
  return <fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}>
    <section className={s.section}><h2>{c("Posisi & pengalaman")}</h2><div className={s.grid}>
      <div className={`${s.field} ${s.positionField}`} data-job-field="title">
        {editingManualTitle ? <label className={s.field}><span>{c("Posisi yang dicari *")}</span>
          <input required name="title" maxLength={200} value={draft.title ?? ''}
            onChange={event => onChange({ ...clearedGroup, title: event.target.value, jobTitleId: null, positionEntryMode: 'MANUAL' })} />
        </label> : <CatalogPositionPicker scope="hr" className={s.positionPicker} label={c("Posisi yang dicari *")} disabled={disabled}
          value={groupId ? [{ id: groupId, kind: 'GROUP', name: draft.title || groupId }]
            : draft.jobTitleId ? [{ id: draft.jobTitleId, kind: 'ROLE', name: catalogTitle ?? draft.title ?? draft.jobTitleId }] : []}
          onChange={([position]) => onChange(position?.kind==='GROUP'
            ? {title:position.name,jobTitleId:null,positionEntryMode:'GROUP',positionGroupId:position.id,positionGroupScopeRevision:null}
            : { ...clearedGroup, title:position?.name??'',jobTitleId:position?.id??null,positionEntryMode:position?'CATALOG':'MANUAL' })} />}
        {groupId && <JobPositionGroupScope key={groupId} id={groupId} confirmed={draft.positionGroupScopeRevision}
          approved={approvedMembers} disabled={disabled} onConfirm={revision=>onChange({positionGroupScopeRevision:revision})}/>}
        <button type="button" className={s.secondary} disabled={disabled} onClick={() => {
          setManualTitle(!editingManualTitle);
          onChange({ ...clearedGroup, title: editingManualTitle?'':draft.title, jobTitleId: null, positionEntryMode: 'MANUAL' });
        }}>{editingManualTitle ? c("Pilih dari katalog") : c("Ketik posisi manual")}</button>
      </div>
      <label className={`${s.field} ${s.seniorityField}`} data-job-field="seniorityLevelCode"><span>{c("Senioritas")}</span><select aria-label={c("Senioritas")} name="seniorityLevelCode" value={draft.seniorityLevelCode??''} onChange={e=>void chooseLevel(e.target.value)}><option value="">{c("Pilih senioritas")}</option>{levels.map(v=><option value={v.code} key={v.code}>{locale==='id'?(v.nameId??v.name):v.name}</option>)}</select></label>
    </div>
    {fieldErrors("title")}{fieldErrors("jobTitleId")}{fieldErrors("seniorityLevelCode")}{fieldErrors("experienceRangeMin")}{fieldErrors("experienceRangeMax")}
    {draft.title&&draft.positionEntryMode==='MANUAL'&&<span className={s.hint}>{c("Posisi manual tetap dapat digunakan. Kecocokan profesi hanya ditampilkan jika pemetaannya tersedia.")}</span>}
    {catalogError&&<div className={s.error} role="alert">{catalogError} <button type="button" className={s.link} onClick={()=>setRetry(v=>v+1)}>{c("Coba muat katalog lagi")}</button></div>}
    {draft.seniorityLevelCode&&<fieldset className={s.range} data-job-field="experienceRangeMin"><legend>{c("Tingkat pengalaman (tahun)")}</legend><div className={s.grid}>
      <label className={s.field}><span>{c("Dari")}</span><input type="number" min={0} max={50} step={1} value={draft.experienceRangeMin??''} aria-invalid={Boolean(rangeInvalid)} onChange={e=>update('experienceRangeMin',e.target.value===''?null:Number(e.target.value))}/></label>
      <label className={s.field}><span>{c("Sampai")}</span><input type="number" min={draft.experienceRangeMin??0} max={50} step={1} value={draft.experienceRangeMax??''} disabled={draft.experienceRangeMax===null} placeholder={c("Tanpa batas atas")} aria-invalid={Boolean(rangeInvalid)} onChange={e=>update('experienceRangeMax',e.target.value===''?null:Number(e.target.value))}/></label>
    </div><span className={s.hint}>{c("Terisi otomatis dari senioritas. Dapat Anda sesuaikan.")}</span><label className={s.check}><input type="checkbox" checked={draft.experienceRangeMax===null} onChange={e=>update('experienceRangeMax',e.target.checked?null:Math.max(draft.experienceRangeMin??0,levels.find(v=>v.code===draft.seniorityLevelCode)?.yearsMax??draft.experienceRangeMin??0))}/>{c("Tanpa batas atas")}</label>{rangeInvalid&&<p className={s.error} role="alert">{c("Isi batas awal yang valid. Batas akhir harus sama atau lebih besar dari batas awal.")}</p>}</fieldset>}
    </section>
    <section className={s.section}><div className={s.aiSectionHeading}><h2>{c("Tanggung jawab & KPI")}</h2><div className={s.aiSectionTools}>
      {aiLanguage&&<JobContentAiLanguageButton language={aiLanguage} disabled={Boolean(aiBusy)} onClick={()=>setAiLanguageDialog('change')}/>}
      <JobContentAiHelp/>
    </div></div>
      <div className={s.field} data-job-field="description"><div className={s.aiFieldHeading}><label htmlFor={descriptionId}>{c("Deskripsi posisi *")}</label><JobContentAiButton label={c("Deskripsi posisi")} disabled={Boolean(aiBusy)||!draft.title?.trim()} loading={aiBusy==='description'} onClick={()=>requestAiSuggestion('description')}/></div>{aiFeedback('description')}<textarea id={descriptionId} name="description" rows={5} minLength={20} maxLength={20000} required value={draft.description??''} onChange={e=>update('description',e.target.value)} placeholder={c("Jelaskan tujuan dan lingkup posisi ini")}/></div>
      {fieldErrors("description")}<div className={s.grid}>{list('responsibilities',c("Tanggung jawab utama"),'responsibilities')}{list('kpis',c("KPI posisi"),'kpis')}</div>
    </section>
    <section className={s.section} data-job-field="skills">
      <div className={s.aiSkillsHeading}>
        <h2>{c("Keahlian & bahasa")}</h2>
        <JobContentAiButton label={c("Keahlian")} disabled={Boolean(aiBusy)||!draft.title?.trim()} loading={aiBusy==='skills'} onClick={()=>requestAiSuggestion('skills')}/>
      </div>
      {aiFeedback('skills')}{fieldErrors('skills')}
      <table className={s.table+' '+s.skillTable} ref={skillsTable}>
        <thead><tr><th>{c("Keahlian")}</th><th>{c("Kebutuhan")}</th><th>{c("Level minimum")}</th><th><span className={s.srOnly}>{c("Hapus")}</span></th></tr></thead>
        <tbody>{skills.map((skill,index)=>{
          const key=skillKeys[index];
          const rowLabel=c("Keahlian")+' '+(index+1);
          return <tr key={key}>
            <td data-label={c("Keahlian")}><input type="text" aria-label={rowLabel} placeholder={c("Nama keahlian")}
              data-skill-key={key} maxLength={SKILL_NAME_MAX_LENGTH} value={skill.name??skill.slug??''} autoComplete="off"
              aria-invalid={validationIssues.some(issue=>issue.path==='skills.'+index+'.name')||undefined}
              onChange={event=>updateSkill(index,{name:event.target.value,slug:undefined})}/></td>
            <td data-label={c("Kebutuhan")}><select aria-label={c("Kebutuhan")+' '+rowLabel} value={skill.isRequired===false?'OPTIONAL':'REQUIRED'}
              onChange={event=>updateSkill(index,{isRequired:event.target.value==='REQUIRED'})}>
              <option value="REQUIRED">{c("Wajib")}</option><option value="OPTIONAL">{c("Nilai tambah")}</option>
            </select></td>
            <td data-label={c("Level minimum")}><select aria-label={c("Level minimum")+' '+rowLabel} value={skill.minLevel??''}
              onChange={event=>updateSkill(index,{minLevel:event.target.value||null})}>
              <option value="">{c("Belum ditentukan")}</option>{[['BEGINNER','Pemula'],['INTERMEDIATE','Menengah'],['ADVANCED','Mahir'],['EXPERT','Ahli']].map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select></td>
            <td><button className={s.icon} type="button" aria-label={c("Hapus")+' '+rowLabel} onClick={()=>removeSkill(index)}>×</button></td>
          </tr>;
        })}</tbody>
      </table>
      <HrAddItemButton fullWidth disabled={!skillCapacity} onClick={()=>appendSkills([{name:'',isRequired:true,weight:1,minLevel:null}],true)}>{c("Tambah keahlian")}</HrAddItemButton>
      <hr className={s.separator}/>
      <div data-job-field="languages">
        {fieldErrors("languages")}
        <table className={s.table}>
          <thead><tr><th>{c("Bahasa")}</th><th>{c("Kebutuhan")}</th><th>{c("Level minimum")}</th><th><span className={s.srOnly}>{c("Hapus")}</span></th></tr></thead>
          <tbody>{languages.map((language,index)=>{
            const name=language.name??language.code;
            return <tr key={language.code??name}>
              <td><span className={s.tableValue}>{name}</span></td>
              <td data-label={c("Kebutuhan")}><select aria-label={c("Kebutuhan")+' · '+name} value={language.isRequired?'REQUIRED':'OPTIONAL'}
                onChange={e=>update('languages',languages.map((row,i)=>i===index?{...row,isRequired:e.target.value==='REQUIRED',confirmed:true}:row))}>
                <option value="REQUIRED">{c("Wajib")}</option><option value="OPTIONAL">{c("Nilai tambah")}</option>
              </select></td>
              <td data-label={c("Level minimum")}><select aria-label={c("Level minimum")+' · '+name} value={language.minLevel}
                onChange={e=>update('languages',languages.map((row,i)=>i===index?{...row,minLevel:e.target.value,confirmed:true}:row))}>
                {LANGUAGE_LEVELS.map(level=><option value={level} key={level}>{level==='NATIVE'?c("Penutur asli"):level}</option>)}
              </select></td>
              <td><button className={s.icon} type="button" aria-label={c("Hapus")+' · '+name}
                onClick={()=>update('languages',languages.filter((_,i)=>i!==index))}>×</button></td>
            </tr>;
          })}</tbody>
        </table>
        {addingLanguage && <div ref={languagePicker} className={s.lookup}>
          <LookupCombobox kind="languages" focusSuggestions keepOpenOnPick excludedCodes={languages.map(row=>row.code)} onPick={item=>{
            const code=item.code??item.slug;
            if(!code||languages.length>=JOB_LANGUAGE_LIMIT||languages.some(row=>row.code===code))return;
            update('languages',[...languages,{code,name:item.name,minLevel:'B1',isRequired:true,confirmed:true}]);
            if(languages.length+1===JOB_LANGUAGE_LIMIT)setAddingLanguage(false);
          }}/>
        </div>}
        {addingLanguage
          ? <button className={s.link} type="button" onClick={()=>setAddingLanguage(false)}>{t('pc.done')}</button>
          : <HrAddItemButton fullWidth disabled={languages.length>=JOB_LANGUAGE_LIMIT} onClick={()=>setAddingLanguage(true)}>{c("Tambah bahasa")}</HrAddItemButton>}
      </div>
    </section>
    <section className={s.section} data-job-field="specificExpectations">{fieldErrors("specificExpectations")}<h2>{c("Harapan spesifik posisi")+" "}<small>{c("Nice-to-have")}</small></h2><p className={s.subtitle}>{c("Tambahkan pengalaman atau konteks khusus yang menjadi nilai tambah.")}</p><label className={s.field}><span className={s.srOnly}>{c("Harapan spesifik posisi")}</span><textarea rows={4} maxLength={5000} value={draft.specificExpectations??''} onChange={e=>update('specificExpectations',e.target.value)} placeholder={c("Tuliskan harapan spesifik untuk posisi ini...")}/></label><span className={s.hint}>{c("Contoh: pengalaman menjual SaaS atau membangun relasi dengan BUMN.")}</span></section>
    <section className={s.section} data-job-field="countryId">{["countryId","citySlug","workMode","employmentType","salaryMin","salaryMax","currency","salaryPeriod","benefits"].map(field=>fieldErrors(field))}<h2>{c("Lokasi, pola kerja & kompensasi")}</h2>
      <div className={s.location} style={{marginTop:0}}><LocationFields countryId={draft.countryId??(draft.workMode==='REMOTE'&&!draft.citySlug?'__WORLDWIDE__':'')} citySlug={draft.citySlug??''} initialCity={initialCity} required cityRequired={draft.workMode!=='REMOTE'} allowGlobal={draft.workMode==='REMOTE'} onChange={location=>onChange({countryId:location.countryId||null,citySlug:location.citySlug})}/></div>
      <div className={s.grid} style={{marginTop:20}}><label className={s.field}><span>{c("Pola kerja")}</span><select name="workMode" aria-label={c("Pola kerja")} value={draft.workMode??'ONSITE'} onChange={e=>onChange({workMode:e.target.value,...(e.target.value!=='REMOTE'&&draft.countryId==='__WORLDWIDE__'?{countryId:null,citySlug:''}:{})})}><option value="ONSITE">{c("Di kantor")}</option><option value="HYBRID">{c("Hybrid")}</option><option value="REMOTE">{c("Remote")}</option></select></label><label className={s.field}><span>{c("Jenis pekerjaan")}</span><select value={draft.employmentType??'FULL_TIME'} onChange={e=>update('employmentType',e.target.value)}>{[['FULL_TIME',c("Penuh waktu")],['PART_TIME',c("Paruh waktu")],['CONTRACT','Kontrak'],['INTERNSHIP','Magang'],['TEMPORARY','Sementara']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label></div>
      <h3>{c("Rentang gaji (opsional)")}</h3><div className={s.grid}><label className={s.field}><span>{c("Dari")}</span><input type="number" min={0} value={draft.salaryMin??''} placeholder={c("Gaji minimum")} onChange={e=>update('salaryMin',e.target.value===''?null:Number(e.target.value))}/></label><label className={s.field}><span>{c("Sampai")}</span><input type="number" min={draft.salaryMin??0} value={draft.salaryMax??''} placeholder={c("Gaji maksimum")} onChange={e=>update('salaryMax',e.target.value===''?null:Number(e.target.value))}/></label><label className={s.field}><span>{c("Mata uang")}</span><select value={draft.currency??'IDR'} onChange={e=>update('currency',e.target.value)}>{[...new Set([...currencies,draft.currency??'IDR'])].sort().map(code=><option key={code} value={code}>{code}</option>)}</select></label><label className={s.field}><span>{c("Periode")}</span><select value={draft.salaryPeriod??'MONTHLY'} onChange={e=>update('salaryPeriod',e.target.value)}><option value="MONTHLY">{c("Bulanan")}</option><option value="YEARLY">{c("Tahunan")}</option><option value="HOURLY">{c("Per jam")}</option></select></label></div>
      <h3>{c("Benefit")}</h3><div className={s.chips} style={{marginBottom:12}}>{benefits.map((v,index)=><span className={s.chip} key={v.slug??v.name}>{v.name}<button type="button" aria-label={`Hapus benefit ${v.name}`} onClick={()=>update('benefits',benefits.filter((_,i)=>i!==index))}>×</button></span>)}<HrAddItemButton disabled={benefits.length>=20} aria-expanded={addingBenefit} onClick={()=>setAddingBenefit(v=>!v)}>{addingBenefit?c("Tutup pencarian"):c("Tambah benefit")}</HrAddItemButton></div>{addingBenefit&&<div className={s.lookup}><LookupCombobox kind="benefits" focusSuggestions allowCreate submitLabel={c("Tambah benefit")} placeholder={c("Cari atau tambahkan benefit")} onPick={item=>{if(benefits.length<20&&!benefits.some(v=>(v.slug??v.name)===(item.slug??item.name))){update('benefits',[...benefits,item]);setAddingBenefit(false);}}}/></div>}
    </section>
    {aiLanguageDialog&&<JobContentAiLanguageDialog initialLanguage={aiLanguage}
      targetLabel={aiLanguageDialog==='change'?undefined:aiLabels[aiLanguageDialog]}
      onCancel={()=>setAiLanguageDialog(null)} onConfirm={confirmAiLanguage}/>}
    {aiPreview&&<JobContentAiPreview title={c('Tinjau hasil AI')+': '+aiLabels[aiPreview.target]} onCancel={()=>setAiPreview(null)} onApply={applyAiSuggestion} append={aiPreview.target==='skills'} applyDisabled={aiPreview.target==='skills'&&!selectedAiSkills.length}>
      {aiPreview.target==='description'&&'description'in aiPreview.suggestion?<p>{aiPreview.suggestion.description}</p>:aiPreview.target==='skills'&&'items'in aiPreview.suggestion?<div>
        {(aiPreview.suggestion.items as JobContentAiSkill[]).length===0&&<p>{c("Semua keahlian yang disarankan sudah ada.")}</p>}
        {(aiPreview.suggestion.items as JobContentAiSkill[]).map(skill=>{
          const key=normalizeSkillKey(skill.name), existing=skillNames.has(key), checked=!existing&&selectedAiSkills.includes(key);
          return <label className={s.aiSkillPreview} key={key}>
            <input type="checkbox" checked={checked} disabled={existing||(!checked&&selectedAiSkills.length>=skillCapacity)}
              onChange={event=>setSelectedAiSkills(previous=>event.target.checked?[...previous,key]:previous.filter(value=>value!==key))}/>
            <strong>{skill.name}</strong>
            {existing?<span>{c("Sudah ada")}</span>:<><span>{skill.isRequired?c('Wajib'):c('Nilai tambah')}</span><span>{skill.minLevel?c(({BEGINNER:'Pemula',INTERMEDIATE:'Menengah',ADVANCED:'Mahir',EXPERT:'Ahli'} as Record<string,string>)[skill.minLevel]):c('Level minimum belum ditentukan')}</span></>}
          </label>;
        })}
      </div>:<ul>{('items'in aiPreview.suggestion?(aiPreview.suggestion as {items:string[]}).items:[]).map((item,index)=><li key={item+index}>{item}</li>)}</ul>}
    </JobContentAiPreview>}
  </fieldset>;
}
