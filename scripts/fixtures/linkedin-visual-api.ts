// Synthetic data transport only. Components, styles and dialogs are repo sources.
const scenario=new URLSearchParams(location.search).get('scenario') || 'preview';
const long=new URLSearchParams(location.search).get('long')==='1';
const state=scenario==='expired'?'EXPIRED':scenario==='revoked'?'REVOKED':['disabled','disconnected'].includes(scenario)?'DISCONNECTED':'CONNECTED';
let connection={enabled:scenario!=='disabled',sharingEnabled:scenario!=='disabled',connected:state==='CONNECTED',status:state,displayName:state==='DISCONNECTED'?null:long?'AndiPratamaInternationalTalentAcquisitionManagementProfessional':'Andi Pratama',avatarUrl:null,expiresAt:state==='DISCONNECTED'?null:new Date(Date.now()+(state==='EXPIRED'?-86400000:12*86400000)).toISOString(),autoShareEnabled:false};
const initialStatus:Record<string,string>={unknown:'UNKNOWN','unknown-wait':'UNKNOWN',failed:'FAILED',queued:'PENDING',publishing:'PUBLISHING',published:'PUBLISHED'};
let posts=initialStatus[scenario]?[{id:'fixture-post',jobId:'fixture-job',status:initialStatus[scenario],attempts:1,retrySafe:scenario==='failed',reviewAfter:scenario==='unknown-wait'?new Date(Date.now()+120000).toISOString():null,createdAt:new Date().toISOString(),nextAttemptAt:new Date(Date.now()+120000).toISOString(),publishedAt:scenario==='published'?new Date().toISOString():null,providerPostUrn:scenario==='published'?'urn:li:share:1234567890123456789':null,errorCode:scenario==='failed'?'ACCESS_DENIED':null}]:[];
let failureShown=false;
export class ApiError extends Error {constructor(message:string,readonly status:number){super(message);}}
export async function api(route:string,options:{method?:string;body?:string}={}){
  if(route.startsWith('/benefits/jobs/'))return {code:'PREMIUM',selected:true,expiresAt:new Date(Date.now()+86400000).toISOString()};
  if(route==='/integrations/linkedin'){
    if(scenario==='settings-error'&&!failureShown){failureShown=true;throw new ApiError('Synthetic outage',503);}
    if(options.method==='PATCH')connection={...connection,autoShareEnabled:JSON.parse(options.body!).autoShareEnabled};
    if(options.method==='DELETE')connection={...connection,status:'DISCONNECTED',connected:false,autoShareEnabled:false,expiresAt:null,displayName:null};
    return connection;
  }
  if(route.endsWith('/linkedin/preview')){
    if(scenario==='prepare-failure'&&!failureShown){failureShown=true;throw new ApiError('Synthetic preparation failure',503);}
    return {id:'fixture-approval',posterDataUrl:'/poster.png',caption:'Kami sedang merekrut: Senior Frontend Developer\nPerusahaan: Talentio Design Studio\nLokasi: Jakarta, Indonesia\nJenis pekerjaan: Penuh waktu | Hibrida\nGaji: IDR 20.000.000 – 30.000.000 / bulan\nLamar: https://jobtalent.io/id/jobs/fixture-job?utm_source=linkedin\n#Hiring #Jobs',jobUrl:'https://jobtalent.io/id/jobs/fixture-job',expiresAt:new Date(Date.now()+1800000).toISOString()};
  }
  if(route.includes('/reconcile'))posts=[{...posts[0],status:JSON.parse(options.body!).outcome==='PUBLISHED'?'PUBLISHED':'FAILED',retrySafe:true}];
  if(route.includes('/cancel'))posts=[{...posts[0],status:'CANCELLED',retrySafe:true}];
  if(route.includes('/retry')||(route.endsWith('/social-posts')&&options.method==='POST'))posts=[{id:'fixture-post',jobId:'fixture-job',status:'PENDING',attempts:1,retrySafe:true,reviewAfter:null,nextAttemptAt:new Date().toISOString(),errorCode:null} as any];
  if(route.includes('social-posts'))return posts;
  return {};
}
