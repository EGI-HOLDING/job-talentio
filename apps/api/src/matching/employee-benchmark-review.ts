/** Offline human review UI. It never displays machine scores or machine ranking. */
export function employeeBenchmarkReviewHtml(dataset: unknown, template: unknown): string {
    const data = JSON.stringify({ dataset, template }).replace(/</g, '\\u003c');
    const script = String.raw `
const {dataset,template}=JSON.parse(document.getElementById('data').textContent);
const storageKey='employee-review:'+template.datasetHash;
let labels=JSON.parse(localStorage.getItem(storageKey)||'null')||structuredClone(template),profileIndex=0;
const el=(tag,text,parent)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(parent)parent.append(node);return node;};
const save=()=>{labels.reviewedBy=document.getElementById('reviewer').value.trim()||null;localStorage.setItem(storageKey,JSON.stringify(labels));};
const header=document.getElementById('controls');
const reviewer=el('input',undefined,header);reviewer.id='reviewer';reviewer.placeholder='Reviewer name';reviewer.value=labels.reviewedBy||'';reviewer.oninput=save;reviewer.setAttribute('aria-label','Reviewer name');
const select=el('select',undefined,header);select.setAttribute('aria-label','Candidate scenario');dataset.profiles.forEach((p,i)=>{const option=el('option',p.id+' — '+p.split,select);option.value=i;});select.onchange=()=>{profileIndex=Number(select.value);render();};
const download=el('button','Export human labels',header);download.onclick=()=>{save();if(!labels.reviewedBy){alert('Enter the reviewer name.');return;}labels.reviewedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(labels,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='human-labels.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const importInput=el('input',undefined,header);importInput.type='file';importInput.accept='.json';importInput.setAttribute('aria-label','Import existing review');importInput.onchange=async()=>{try{const incoming=JSON.parse(await importInput.files[0].text());if(incoming.datasetHash!==template.datasetHash)throw Error('Review belongs to a different dataset');labels=incoming;reviewer.value=labels.reviewedBy||'';save();render();}catch(e){alert(e.message);}};
function render(){
 const host=document.getElementById('review');host.replaceChildren();const p=dataset.profiles[profileIndex],label=labels.profiles.find(l=>l.id===p.id);
 el('h2',p.id,host);const selected=dataset.catalog.filter(r=>p.preferences.selectedIds.includes(r.id));el('p','Selected positions: '+selected.map(r=>r.name+' / '+(r.nameId||'')+' [family '+r.familyId+']').join('; '),host);
 el('p','Career scenario: '+p.scenario+' | Preferred country: Indonesia | Work mode: '+p.preferences.preferredWorkModes.join(', ')+' | Minimum salary: '+p.preferences.desiredSalaryMin+' '+p.preferences.desiredSalaryCurrency,host);
 const details=el('details',undefined,host);details.open=true;el('summary','Candidate CV and evidence',details);el('pre',p.cv,details);el('pre',JSON.stringify(p.facts,null,2),details);
 const complete=Object.values(label.grades).filter(g=>Number.isInteger(g)).length;el('p','Reviewed grades: '+complete+' / '+dataset.jobs.length,host);
 const groups=new Map();for(const job of dataset.jobs){const rows=groups.get(job.jobTitleId)||[];rows.push(job);groups.set(job.jobTitleId,rows);}
 for(const [roleId,jobs] of groups){
  const role=dataset.catalog.find(r=>r.id===roleId),section=el('details',undefined,host);section.open=p.preferences.selectedIds.includes(roleId);el('summary',role.name+' [family '+role.familyId+'] — '+jobs.length+' jobs',section);
  const actions=el('div',undefined,section);el('p','Review this entire position group before using a bulk action. Individual jobs can be changed below.',actions);
  const exclude=el('button','Mark this group ineligible / grade 0',actions);exclude.onclick=()=>{for(const job of jobs){label.eligibleJobIds=label.eligibleJobIds.filter(id=>id!==job.id);label.grades[job.id]=0;}save();render();};
  const include=el('button','Mark this group eligible',actions);include.onclick=()=>{label.eligibleJobIds=[...new Set([...label.eligibleJobIds,...jobs.map(j=>j.id)])];save();render();};
  for(const job of jobs){const article=el('article',undefined,section);el('strong',job.id+' — '+job.title,article);el('p','Experience: '+job.experienceYearsMin+' years | '+job.workMode+' | '+job.countryId+' / '+job.cityId+' | Salary '+job.salaryMin+'–'+job.salaryMax+' '+job.currency+' '+job.salaryPeriod,article);el('p','Skills: '+job.jobSkills.map(s=>s.skill.name+(s.minLevel?' ['+s.minLevel+']':'')+(s.isRequired?' required':' optional')).join('; '),article);
   const eligibleLabel=el('label','Position/family eligible ',article),checkbox=el('input',undefined,eligibleLabel);checkbox.type='checkbox';checkbox.checked=label.eligibleJobIds.includes(job.id);checkbox.onchange=()=>{label.eligibleJobIds=checkbox.checked?[...new Set([...label.eligibleJobIds,job.id])]:label.eligibleJobIds.filter(id=>id!==job.id);save();};
   const gradeLabel=el('label',' Relevance grade ',article),grade=el('select',undefined,gradeLabel);for(const [value,text] of [['','Not reviewed'],['0','0 — irrelevant'],['1','1 — weak'],['2','2 — useful'],['3','3 — excellent']]){const option=el('option',text,grade);option.value=value;}grade.value=Number.isInteger(label.grades[job.id])?String(label.grades[job.id]):'';grade.onchange=()=>{label.grades[job.id]=grade.value===''?null:Number(grade.value);save();};
  }
 }
}
render();`;
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Employee matching — independent human review</title><style>body{font:16px system-ui;max-width:1100px;margin:auto;padding:24px;background:#f7f8fa;color:#17202e}#controls{display:flex;flex-wrap:wrap;gap:12px;position:sticky;top:0;background:#fff;padding:16px;border:1px solid #ccd2db}input,select,button{font:inherit;padding:8px}button{cursor:pointer}details,article{background:white;border:1px solid #ccd2db;padding:16px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}summary{cursor:pointer;font-weight:600}label{margin-right:16px}</style><h1>Independent human review</h1><p>Judge the selected position/family boundary and usefulness of jobs for each candidate. Grades: 0 irrelevant, 1 weak, 2 useful, 3 excellent. Machine ranking is intentionally not shown. Your edits stay in this browser until exported. Evaluation scenarios are held out from tuning.</p><div id="controls"></div><main id="review"></main><script id="data" type="application/json">${data}</script><script>${script}</script></html>`;
}
