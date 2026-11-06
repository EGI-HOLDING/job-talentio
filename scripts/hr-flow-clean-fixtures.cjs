const h=require('./business-catalog-local.cjs');h.url.pathname='/'+h.name;
const {PrismaClient}=h.api('@prisma/client'),{S3Client,DeleteObjectCommand}=h.api('@aws-sdk/client-s3');
async function run(){
 const db=new PrismaClient({datasources:{db:{url:h.url.toString()}}});
 const endpoint=new URL(h.env.S3_ENDPOINT);if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||endpoint.port!=='9100')throw Error('Isolated local object storage only');
 const s3=new S3Client({endpoint:endpoint.href,region:h.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:h.env.S3_ACCESS_KEY,secretAccessKey:h.env.S3_SECRET_KEY}});
 let count=0;
 try{
  const companies=await db.company.findMany({where:{slug:{startsWith:'hr-flow-browser-'}},include:{members:{include:{user:true}}}});
  for(const company of companies){
   if(company.members.length!==1||!company.members[0].user.email?.endsWith('@example.invalid'))throw Error('Unexpected fixture owner');
   const userId=company.members[0].userId;
   if(await db.application.count({where:{jobPost:{companyId:company.id}}}))throw Error('Fixture has applications; refusing cleanup');
   const documents=await db.companyProfileDocument.findMany({where:{ownerId:userId}}),orders=await db.jobPurchaseOrder.findMany({where:{companyId:company.id},select:{id:true}});
   await db.$transaction(async tx=>{
    await tx.company.update({where:{id:company.id},data:{profileDocumentId:null,profileSource:'MANUAL'}});
    await tx.recruiterOnboarding.deleteMany({where:{userId}});
    await tx.jobCreationSession.updateMany({where:{companyId:company.id},data:{jobId:null,orderId:null}});
    await tx.jobPaymentEvent.deleteMany({where:{orderId:{in:orders.map(o=>o.id)}}});
    await tx.jobPurchaseOrder.deleteMany({where:{companyId:company.id}});await tx.jobCreationSession.deleteMany({where:{companyId:company.id}});
    await tx.companyProfileDocument.deleteMany({where:{ownerId:userId}});await tx.jobPost.deleteMany({where:{companyId:company.id}});await tx.companyMember.deleteMany({where:{companyId:company.id}});await tx.company.delete({where:{id:company.id}});
    await tx.operationKey.deleteMany({where:{OR:[{scope:{endsWith:':'+userId}},{scope:'job-payment-session',key:{in:orders.map(o=>o.id)}}]}});await tx.auditLog.deleteMany({where:{actorId:userId}});await tx.user.delete({where:{id:userId}});
   });
   for(const doc of documents){if(!doc.fileKey.startsWith('company-profiles/'+userId+'/'))throw Error('Unexpected fixture storage key');await s3.send(new DeleteObjectCommand({Bucket:'talentio-hr-flow-local-test',Key:doc.fileKey}));}
   count++;
  }
  console.log(JSON.stringify({cleanedBrowserFixtures:count,database:h.name}));
 }finally{s3.destroy();await db.$disconnect();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
