import { jobPostSchema } from '@job-talentio/shared';

export type HrDraft = Record<string, any>;
export type HrDraftIssue = { field: string; path: string; message: string };
const draftKeys = new Set([
  'title','description','positionEntryMode','jobTitleId','seniorityLevelCode','experienceRangeMin','experienceRangeMax','responsibilities','kpis','specificExpectations','countryId','citySlug','workMode','employmentType','salaryMin','salaryMax','salaryPeriod','currency','skills','languages','benefits',
]);

// A manual lookup intentionally returns slug: ''. Omit absent catalog identifiers
// while retaining the entered name; use the same payload for autosave and submit.
export function cleanHrDraft(draft: HrDraft): HrDraft {
  const body = Object.fromEntries(Object.entries(draft).filter(([key])=>draftKeys.has(key)));
  if (body.countryId === '__WORLDWIDE__') body.countryId = null;
  for (const field of ['skills','benefits','languages']) {
    if (!Array.isArray(body[field])) continue;
    body[field] = body[field].map((row: Record<string, any>) => {
      const value = {...row};
      for (const key of ['slug','code','name']) {
        if (typeof value[key] === 'string') value[key] = value[key].trim();
        if (value[key] === '' || value[key] === null) delete value[key];
      }
      return value;
    });
  }
  for (const field of ['responsibilities','kpis']) {
    if (Array.isArray(body[field])) body[field] = body[field].map((value: string)=>value.trim()).filter(Boolean);
  }
  return body;
}

const labels: Record<string,string> = {
  title:'Posisi yang dicari',description:'Deskripsi posisi',jobTitleId:'Posisi katalog',positionEntryMode:'Pilihan posisi',seniorityLevelCode:'Senioritas',experienceRangeMin:'Pengalaman minimum',experienceRangeMax:'Pengalaman maksimum',responsibilities:'Tanggung jawab utama',kpis:'KPI posisi',specificExpectations:'Harapan spesifik posisi',countryId:'Negara',citySlug:'Kota',workMode:'Pola kerja',employmentType:'Jenis pekerjaan',salaryMin:'Gaji minimum',salaryMax:'Gaji maksimum',currency:'Mata uang',salaryPeriod:'Periode gaji',skills:'Keahlian',languages:'Bahasa',benefits:'Benefit',
};
export function validateHrDraft(draft: HrDraft) {
  const body=cleanHrDraft(draft);
  const parsed=jobPostSchema.safeParse(body);
  const issues: HrDraftIssue[] = parsed.success ? [] : parsed.error.issues.map(issue=>{
    const field=String(issue.path[0]??'title');
    const row=typeof issue.path[1]==='number' ? ` ${issue.path[1]+1}` : '';
    const label=(labels[field]??field)+row;
    let detail='periksa nilai yang dipilih atau masukkan ulang.';
    if(issue.code==='too_small') detail=`minimal ${issue.minimum} ${issue.type==='string'?'karakter':'item'}.`;
    if(issue.code==='too_big') detail=`maksimal ${issue.maximum} ${issue.type==='string'?'karakter':'item'}.`;
    if(issue.code==='invalid_type') detail=issue.expected==='number'?'masukkan angka yang valid.':'isi dengan nilai yang valid.';
    return {field,path:issue.path.join('.'),message:`${label}: ${detail}`};
  });
  for(const [min,max,label] of [['experienceRangeMin','experienceRangeMax','Pengalaman maksimum'],['salaryMin','salaryMax','Gaji maksimum']]) {
    if(typeof body[min]==='number'&&typeof body[max]==='number'&&body[max]<body[min]) issues.push({field:max,path:max,message:`${label} harus sama atau lebih besar dari minimum.`});
  }
  return {body,issues};
}

export function focusHrDraftIssue(field: string) {
  const target=document.querySelector<HTMLElement>(`#hr-job-form [data-job-field="${field}"]`)
    ??document.querySelector<HTMLElement>('#hr-job-form');
  target?.scrollIntoView({behavior:'smooth',block:'center'});
  const control=target?.matches('input,textarea,select,button')?target:(target?.querySelector<HTMLElement>('input:not([type=hidden]),textarea,select')??target?.querySelector<HTMLElement>('button'));
  control?.focus({preventScroll:true});
}
