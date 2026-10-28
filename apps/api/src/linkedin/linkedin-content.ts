import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { sha256 } from './linkedin-security';

export type ShareLocale = 'id' | 'en' | 'ru' | 'uz';
const labels = {
  en: { hiring: "We're hiring", company:'Company', location:'Location', type:'Employment', mode:'Work arrangement', apply:'Apply', view:'View job and apply', anonymous:'Confidential employer', worldwide:'Worldwide', salary:'Salary', MONTHLY:'month', YEARLY:'year', HOURLY:'hour' },
  id: { hiring:'Kami sedang merekrut', company:'Perusahaan', location:'Lokasi', type:'Jenis pekerjaan', mode:'Pengaturan kerja', apply:'Lamar', view:'Lihat lowongan dan lamar', anonymous:'Perusahaan rahasia', worldwide:'Seluruh dunia', salary:'Gaji', MONTHLY:'bulan', YEARLY:'tahun', HOURLY:'jam' },
  ru: { hiring:'Мы ищем сотрудников', company:'Компания', location:'Место работы', type:'Занятость', mode:'Формат работы', apply:'Откликнуться', view:'Посмотреть вакансию', anonymous:'Конфиденциальный работодатель', worldwide:'По всему миру', salary:'Зарплата', MONTHLY:'месяц', YEARLY:'год', HOURLY:'час' },
  uz: { hiring:'Biz ishga taklif qilamiz', company:'Kompaniya', location:'Joylashuv', type:'Bandlik', mode:'Ish tartibi', apply:'Ariza yuborish', view:'Vakansiyani ko‘rish va ariza yuborish', anonymous:'Maxfiy ish beruvchi', worldwide:'Butun dunyo', salary:'Maosh', MONTHLY:'oy', YEARLY:'yil', HOURLY:'soat' },
};
const employment: Record<ShareLocale,Record<string,string>> = {
  en:{FULL_TIME:'Full-time',PART_TIME:'Part-time',CONTRACT:'Contract',INTERNSHIP:'Internship',TEMPORARY:'Temporary'},
  id:{FULL_TIME:'Penuh waktu',PART_TIME:'Paruh waktu',CONTRACT:'Kontrak',INTERNSHIP:'Magang',TEMPORARY:'Sementara'},
  ru:{FULL_TIME:'Полная занятость',PART_TIME:'Частичная занятость',CONTRACT:'Контракт',INTERNSHIP:'Стажировка',TEMPORARY:'Временная работа'},
  uz:{FULL_TIME:'To‘liq ish kuni',PART_TIME:'Qisman bandlik',CONTRACT:'Shartnoma',INTERNSHIP:'Amaliyot',TEMPORARY:'Vaqtinchalik'},
};
const workMode: Record<ShareLocale,Record<string,string>> = {
  en:{ONSITE:'On-site',HYBRID:'Hybrid',REMOTE:'Remote'}, id:{ONSITE:'Di kantor',HYBRID:'Hibrida',REMOTE:'Jarak jauh'},
  ru:{ONSITE:'В офисе',HYBRID:'Гибрид',REMOTE:'Удалённо'}, uz:{ONSITE:'Ofisda',HYBRID:'Gibrid',REMOTE:'Masofadan'},
};
type Name = { name: string; nameUz?: string | null; nameRu?: string | null; nameId?: string | null };
export type ShareJob = {
  id:string; title:string; company:{ name:string }; isAnonymous:boolean; locale:string;
  city: Name | null; country: Name | null; employmentType:string; workMode:string;
  salaryMin:number | null; salaryMax:number | null; salaryPeriod:string; currency:string;
};
export type ShareContent = {
  version:1; locale:ShareLocale; jobId:string; title:string; companyName:string; location:string;
  employment:string; workMode:string; salary:string | null; isAnonymous:boolean; jobUrl:string;
};
const clean = (value:string, max=250) => value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
function localized(row:Name | null,locale:ShareLocale) {
  if (!row) return '';
  return clean((locale==='id'?row.nameId:locale==='ru'?row.nameRu:locale==='uz'?row.nameUz:row.name) || row.name);
}
export function buildShareContent(job:ShareJob, locale:ShareLocale, siteUrl:string):ShareContent {
  const l = labels[locale];
  const url = new URL(`/${locale}/jobs/${encodeURIComponent(job.id)}`,siteUrl);
  url.searchParams.set('utm_source','linkedin'); url.searchParams.set('utm_medium','organic_social'); url.searchParams.set('utm_campaign','job_share');
  const numbers = new Intl.NumberFormat(locale === 'uz' ? 'uz-UZ' : locale);
  const amounts = [job.salaryMin,job.salaryMax].filter((value):value is number=>value!==null).map(value=>numbers.format(value));
  const rangeLabels={en:{from:'From',upTo:'Up to'},id:{from:'Mulai',upTo:'Hingga'},ru:{from:'От',upTo:'До'},uz:{from:'Kamida',upTo:'Gacha'}}[locale];
  const amountText=job.salaryMin!==null&&job.salaryMax!==null?(job.salaryMin===job.salaryMax?amounts[0]:amounts.join(' – ')):job.salaryMin!==null?`${rangeLabels.from} ${amounts[0]}`:job.salaryMax!==null?`${rangeLabels.upTo} ${amounts[0]}`:'';
  const period = l[job.salaryPeriod as 'MONTHLY'|'YEARLY'|'HOURLY'] || job.salaryPeriod;
  return {version:1,locale,jobId:job.id,title:clean(job.title,200),companyName:job.isAnonymous?l.anonymous:clean(job.company.name,200),
    location:[localized(job.city,locale),localized(job.country,locale)].filter(Boolean).join(', ') || (job.workMode==='REMOTE'?l.worldwide:''),
    employment:employment[locale][job.employmentType] || job.employmentType,workMode:workMode[locale][job.workMode] || job.workMode,
    salary:amounts.length?`${clean(job.currency,3)} ${amountText} / ${period}`:null,isAnonymous:job.isAnonymous,jobUrl:url.toString()};
}
export function shareCaption(content:ShareContent) {
  const l=labels[content.locale];
  return [`${l.hiring}: ${content.title}`,`${l.company}: ${content.companyName}`,content.location?`${l.location}: ${content.location}`:'',`${l.type}: ${content.employment} | ${content.workMode}`,content.salary?`${l.salary}: ${content.salary}`:'',`${l.apply}: ${content.jobUrl}`,'#Hiring #Jobs'].filter(Boolean).join('\n');
}
export const shareFingerprint = (content:ShareContent) => sha256(JSON.stringify(content));
let fontsRegistered=false;
function registerShareFonts() {
  if(fontsRegistered)return;
  for(const name of ['NotoSans-Regular.ttf','NotoSans-Bold.ttf']) {
    if(!GlobalFonts.registerFromPath(resolve(__dirname,'../../assets/fonts',name),'Talentio Share'))throw new Error('LinkedIn poster font unavailable');
  }
  fontsRegistered=true;
}

/** No logos or remote assets are fetched: rendering cannot perform SSRF. */
export function renderSharePoster(content:ShareContent):Buffer {
  registerShareFonts();
  const canvas=createCanvas(1200,1200),ctx=canvas.getContext('2d'),l=labels[content.locale];
  const gradient=ctx.createLinearGradient(0,0,1200,1200);gradient.addColorStop(0,'#f1ecff');gradient.addColorStop(.65,'#ffffff');gradient.addColorStop(1,'#e9f3ff');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,1200,1200);
  ctx.strokeStyle='#dcd3ff';ctx.lineWidth=55;ctx.beginPath();ctx.arc(1160,920,200,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#5635e8';ctx.font='700 32px "Talentio Share"';ctx.fillText('Job Talentio',80,100);
  ctx.font='600 27px "Talentio Share"';ctx.fillText(l.hiring.toLocaleUpperCase(content.locale),80,185);
  function line(value:string,x:number,y:number,width:number) {
    let result=value;
    if(ctx.measureText(result).width>width) {
      while(result.length && ctx.measureText(result+'…').width>width) result=result.slice(0,-1);
      result=result.replace(/\s+$/,'')+'…';
    }
    ctx.fillText(result,x,y);
  }
  function wrapped(value:string,x:number,y:number,width:number,height:number,max:number) {
    const words=value.split(/\s+/);let current='',row=0;
    for(let i=0;i<words.length;i++) {
      const next=current?current+' '+words[i]:words[i];
      if(ctx.measureText(next).width>width && current) {
        if(row===max-1){line(current+' '+words.slice(i).join(' '),x,y+row*height,width);return;}
        line(current,x,y+row*height,width);row++;current=words[i];
      } else current=next;
    }
    if(current)line(current,x,y+row*height,width);
  }
  ctx.fillStyle='#53617a';ctx.font='500 31px "Talentio Share"';line(content.companyName,80,260,1030);
  ctx.fillStyle='#101b35';ctx.font='700 80px "Talentio Share"';wrapped(content.title,80,390,1030,94,3);
  ctx.fillStyle='#53617a';ctx.font='400 36px "Talentio Share"';wrapped(content.location,80,755,1010,45,2);
  ctx.font='500 30px "Talentio Share"';line(`${content.employment}  •  ${content.workMode}`,80,880,1010);
  if(content.salary){ctx.fillStyle='#00867f';ctx.font='600 32px "Talentio Share"';line(content.salary,80,950,1000);}
  ctx.fillStyle='#5635e8';ctx.fillRect(80,1030,1040,88);ctx.fillStyle='#ffffff';ctx.font='600 29px "Talentio Share"';line(l.view,110,1087,980);
  const png=canvas.toBuffer('image/png');validateSharePoster(png);return png;
}
export function validateSharePoster(bytes:Buffer) {
  if(bytes.length<24 || bytes.length>5*1024*1024 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.readUInt32BE(16)!==1200 || bytes.readUInt32BE(20)!==1200)throw new Error('Invalid LinkedIn poster');
}
