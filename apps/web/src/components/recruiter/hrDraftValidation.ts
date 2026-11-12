import { jobPostSchema, catalogLabelIssue } from '@job-talentio/shared';

export type HrDraft = Record<string, any>;
export type HrDraftIssue = { field: string; path: string; message: string };
export function hrJobError(error: unknown) {
  const message=error instanceof Error?error.message:String(error);
  if(message.includes('POSITION_GROUP_SCOPE_CHANGED'))return 'Cakupan kelompok berubah. Buka cakupan, tinjau daftar terbaru, lalu konfirmasi lagi.';
  if(message.includes('POSITION_GROUP_HAS_NO_VERIFIED_MEMBERS'))return 'Kelompok ini belum memiliki posisi terverifikasi.';
  if(message.includes('POSITION_GROUP_UNAVAILABLE')||message.includes('JOB_POSITION_GROUPS_UNAVAILABLE'))return 'Kelompok posisi ini sedang tidak tersedia.';
  if(message.includes('JOB_TEMPLATE_REVIEW_REQUIRED'))return 'Periksa isi draf sebelum menerbitkan. Paket yang sudah dikonfirmasi tetap bisa digunakan.';
  if(message.includes('JOB_TEMPLATE_REQUIRES_PUBLISHED_SOURCE'))return 'Hanya lowongan yang pernah terbit yang bisa dijadikan template.';
  return message;
}
const draftKeys = new Set([
  'title','description','positionEntryMode','jobTitleId','positionGroupId','positionGroupScopeRevision','seniorityLevelCode','experienceRangeMin','experienceRangeMax','responsibilities','kpis','specificExpectations','countryId','citySlug','workMode','employmentType','salaryMin','salaryMax','salaryPeriod','currency','skills','languages','benefits',
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
  if(body.positionEntryMode==='GROUP'&&(!body.positionGroupId||!body.positionGroupScopeRevision)){
    issues.push({field:'title',path:'positionGroupScopeRevision',message:'Tinjau dan konfirmasi cakupan kelompok posisi sebelum menerbitkan.'});
  }
  for(const field of ['skills','benefits','languages']) {
    if(!Array.isArray(body[field]))continue;
    body[field].forEach((row: Record<string,any>,index:number)=>{
      if(row.slug||row.code||!row.name)return;
      const issue=catalogLabelIssue(row.name);
      if(!issue)return;
      const detail=issue==='charset'?'gunakan huruf, angka, spasi, atau tanda baca umum; maksimal 80 karakter.':'gunakan nama keahlian, benefit, atau bahasa yang sesuai.';
      issues.push({field,path:`${field}.${index}.name`,message:`${labels[field]} ${index+1} “${row.name}”: ${detail}`});
    });
  }
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
