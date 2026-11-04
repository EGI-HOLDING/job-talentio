import 'reflect-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { liveJobWhere } from '../benefits/benefit-policy';
import { VacancyTasksService } from '../matching/vacancy-tasks.service';
import { EmployeeCatalogSnapshot } from '../matching/employee-catalog-snapshot';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { VACANCY_TASK_VERSION } from '../matching/vacancy-tasks';

// Judgments for the Indonesian inventory, based on duties. Missing postings
// are excluded from the denominator. Unjudged postings are reported separately.
const judgments = [
  ['Sales Manager', ['Eksekutif Penjualan Area'], ['Manajer Kemitraan Kuliner','Eksekutif Penjualan Armada','Pengelola Akun Food Service','Eksekutif Akun Pelanggan','Koordinator Penjualan Ekspor','Koordinator Penjualan Koleksi','Koordinator Penjualan Acara','Apoteker Produksi','Apoteker Penanggung Jawab','Spesialis Keamanan Obat','Spesialis Registrasi Produk']],
  ['Chef', ['Koki Persiapan Dapur Panas','Koki Dapur Panas','Sous Chef Dapur Panas','Koki Salad dan Hidangan Dingin','Koki Dapur Dingin','Kepala Dapur Dingin','Commis Menu Nusantara','Koki Spesialis Menu Nusantara','Chef Pengembangan Menu Lokal','Supervisor Produksi Dapur','Chef Pastry Restoran'], ['Restaurant Manager','Baker dan Pengembang Pastry','Steward Restoran','Operator Lini Produk Siap Masak','Petugas Penerimaan Bahan Dapur']],
  ['Backend Developer', ['Full-stack Developer','Java Developer','Python Developer'], ['Frontend Developer','Mobile Application Developer','QA Engineer','DevOps Engineer']],
  ['Mechanical Engineer', ['Mechanical Design Engineer'], ['Teknisi Listrik dan Panel Produksi','Koordinator Produksi Siap Masak']],
  ['Nurse Responsible For General Care', ['Perawat Koordinator Klinik'], ['Petugas Layanan Pasien','Apoteker Penanggung Jawab']],
  ['Primary School Teacher', ['Pendidik Anak Usia Dini'], ['English Teacher (Corporate)','Konselor Penerimaan Siswa']],
  ['Tourist Guide', ['Asisten Pemandu Wisata','Pemandu Budaya dan Pesisir'], ['Pengemudi Antar-Jemput Tamu','Admin Reservasi Tur']],
  ['Purchaser', ['Buyer Bahan Pangan','Pembeli Bahan Segar dan Lokal'], ['Supervisor Gudang Pangan','Teknisi Pemeliharaan']],
  ['Inventory Coordinator', ['Pengendali Persediaan Pangan','Pengendali Stok Dapur'], ['Koordinator Pengadaan Outlet','Chef Pengembangan Menu Lokal']],
  ['Food Analyst', ['Analis Laboratorium Pangan','Analis Evaluasi Sensoris Produk'], ['Koki Dapur Dingin','Operator Lini Produk Siap Masak']],
  ['Solar Energy Engineer', ['Insinyur Proyek Tenaga Surya'], ['Petugas Program Energi Komunitas','Petugas Pemantau Cuaca dan Rencana Alternatif']],
  ['Credit Analyst', ['Analis Kredit Komersial'], ['Manajer Relasi Usaha Kecil','Perencana Permintaan Distribusi']],
  ['Industrial Pharmacist', ['Apoteker Produksi'], ['Perawat Koordinator Klinik','Analis Laboratorium Pangan']],
] as const;

async function main(db:PrismaService) {
  const relations=new OccupationRelationsService(db);
  const tasks=new VacancyTasksService(db,relations);
  const dryRun=process.argv.includes('--dry-run');
  if(dryRun&&process.argv.includes('--index'))throw Error('Choose dry run or index build');
  if(process.argv.includes('--index')){
    for(let batches=0;batches<1000;batches++)if(await tasks.refresh()===0)break;
  }
  const {index,roles}=await new EmployeeCatalogSnapshot(db,undefined,relations).get(true);
  const base={id:true,jobTitleId:true,updatedAt:true,publishedAt:true} as const;
  const postings=dryRun?await db.jobPost.findMany({where:liveJobWhere(),select:{...base,description:true}}):null;
  const jobs=postings?postings.map(({description:_description,...job})=>({...job,occupationTaskEvidence:[] as Array<{jobUpdatedAt:Date;coreKeys:string[]}>})):await db.jobPost.findMany({where:liveJobWhere(),select:{...base,occupationTaskEvidence:{where:{version:VACANCY_TASK_VERSION},select:{jobUpdatedAt:true,coreKeys:true}}}});
  const preview=postings?.map(job=>tasks.project(job));
  const previewById=new Map(preview?.map(row=>[row.id,row.keys]));
  const families=new Map<string,{live:number;indexed:number;withTaskEvidence:number}>();
  for(const job of jobs){
    const id=index.identity(job.jobTitleId??'')?.familyId??'UNRESOLVED';
    const report=families.get(id)??{live:0,indexed:0,withTaskEvidence:0};
    const evidence=dryRun?{coreKeys:previewById.get(job.id)??[]}:job.occupationTaskEvidence.find(row=>+row.jobUpdatedAt===+job.updatedAt);
    report.live++;
    if(evidence){report.indexed++;if(evidence.coreKeys.length)report.withTaskEvidence++;}
    families.set(id,report);
  }
  const results=[];
  const regressions:string[]=[];
  for(const [title,positive,negative] of judgments){
    const id=index.resolve(title);
    if(!id)continue;
    const positives=new Set<string>(positive.map(catalogTitleIdentityKey));
    const negatives=new Set<string>(negative.map(catalogTitleIdentityKey));
    const allowed=roles.filter(role=>index.eligibility([id],role.id).eligible).map(role=>role.id);
    const projected=await tasks.select(index,[id],allowed,undefined,preview);
    const counts=()=>({tp:0,fp:0,fn:0,tn:0,unjudged:0});
    const baseline=counts(),candidate=counts();
    const misses:string[]=[],leaks:string[]=[];
    const chosen:string[]=[];
    for(const job of jobs){
      const name=index.roles.get(job.jobTitleId??'')?.name??'';
      const key=catalogTitleIdentityKey(name);
      const selected=projected.decisions.get(job.id)?.eligibility;
      const before=allowed.includes(job.jobTitleId??'');
      const after=Boolean(selected?.eligible);
      if(after)chosen.push(name);
      const record=(group:ReturnType<typeof counts>,included:boolean)=>{
        if(positives.has(key))group[included?'tp':'fn']++;
        else if(negatives.has(key))group[included?'fp':'tn']++;
        else if(included)group.unjudged++;
      };
      record(baseline,before);record(candidate,after);
      if(before&&!after&&positives.has(key))misses.push(name);
      if(!before&&after&&negatives.has(key))leaks.push(name);
    }
    const metrics=(row:ReturnType<typeof counts>)=>({...row,precision:row.tp+row.fp?row.tp/(row.tp+row.fp):null,recall:row.tp+row.fn?row.tp/(row.tp+row.fn):null});
    const b=metrics(baseline),c=metrics(candidate);
    const top=(projectedMode:boolean)=>{
      const ranked=jobs.flatMap(job=>{
        const decision=projectedMode?projected.decisions.get(job.id)?.eligibility:index.eligibility([id],job.jobTitleId);
        return decision?.eligible?[{job,decision}]:[];
      }).sort((a,b)=>Number(a.decision.matchType==='RELATED')-Number(b.decision.matchType==='RELATED')
        ||(b.decision.relationScore??0)-(a.decision.relationScore??0)||(+(b.job.publishedAt??0))-(+(a.job.publishedAt??0))||a.job.id.localeCompare(b.job.id)).slice(0,10);
      const labels=ranked.map(row=>catalogTitleIdentityKey(index.roles.get(row.job.jobTitleId??'')?.name??''));
      const judged=labels.filter(key=>positives.has(key)||negatives.has(key));
      return {judged:judged.length,precision:judged.length?judged.filter(key=>positives.has(key)).length/judged.length:null};
    };
    if(misses.length||leaks.length||(b.precision!==null&&c.precision!==null&&c.precision<b.precision)||(b.recall!==null&&c.recall!==null&&c.recall<b.recall))regressions.push(title);
    if(title==='Sales Manager'&&process.argv.includes('--expect-sales-rescue')&&(candidate.tp!==1||candidate.fp!==0||candidate.unjudged!==0))regressions.push('Sales Manager production snapshot');
    results.push({title,family:index.identity(id)?.familyId,baseline:b,candidate:c,top10:{baseline:top(false),candidate:top(true)},misses,leaks,...(title==='Sales Manager'?{chosen}:{} )});
  }
  const aggregate=[...families.values()].reduce((sum,row)=>({indexed:sum.indexed+row.indexed,withTaskEvidence:sum.withTaskEvidence+row.withTaskEvidence}),{indexed:0,withTaskEvidence:0});
  console.log(JSON.stringify({version:VACANCY_TASK_VERSION,catalogPositions:roles.length,liveJobs:jobs.length,...aggregate,families:Object.fromEntries([...families].sort()),results,regressions}));
  if(regressions.length||aggregate.indexed!==jobs.length)process.exitCode=1;
}
const db=new PrismaService();
void main(db).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
