import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/auth.decorators';
import { StorageService } from '../storage/storage.service';

export async function resolveCompanyProfile(db:Prisma.TransactionClient,user:AuthUser,input:{profileSource?:string;profileDocumentId?:string|null;description?:string},existing?:{id:string;profileSource:string;profileDocumentId:string|null;description:string|null}){
  if(input.profileSource===undefined&&input.profileDocumentId===undefined)return {};
  const profileSource=input.profileSource??existing?.profileSource??'MANUAL';
  const profileDocumentId=input.profileDocumentId===undefined?existing?.profileDocumentId??null:input.profileDocumentId;
  if(profileSource==='DOCUMENT'){
    if(!profileDocumentId)throw new BadRequestException('COMPANY_DOCUMENT_REQUIRED');
    await db.$queryRaw`SELECT id FROM "CompanyProfileDocument" WHERE id=${profileDocumentId} FOR UPDATE`;
    const doc=await db.companyProfileDocument.findUnique({where:{id:profileDocumentId}});
    if(!doc||doc.retiredAt||doc.kind!=='DOCUMENT'||(doc.companyId?doc.companyId!==existing?.id:doc.ownerId!==user.id))throw new BadRequestException('COMPANY_DOCUMENT_UNAVAILABLE');
    if(existing&&!doc.companyId)await db.companyProfileDocument.update({where:{id:doc.id},data:{companyId:existing.id}});
  }else if(profileSource!=='MANUAL')throw new BadRequestException('INVALID_PROFILE_SOURCE');
  return {profileSource,profileDocumentId};
}
export async function attachCompanyLogo(db:Prisma.TransactionClient,storage:StorageService,user:AuthUser,companyId:string,assetId:string){
  await db.$queryRaw`SELECT id FROM "CompanyProfileDocument" WHERE id=${assetId} FOR UPDATE`;
  const asset=await db.companyProfileDocument.findUnique({where:{id:assetId}});
  if(!asset||asset.retiredAt||asset.kind!=='LOGO'||(asset.companyId?asset.companyId!==companyId:asset.ownerId!==user.id))throw new BadRequestException('LOGO_UNAVAILABLE');
  const key='public/company-logos/'+companyId+'/'+asset.id+(asset.contentType==='image/png'?'.png':asset.contentType==='image/webp'?'.webp':'.jpg');
  await storage.copyObject(asset.fileKey,key);
  await db.companyProfileDocument.update({where:{id:asset.id},data:{companyId}});
  await db.company.update({where:{id:companyId},data:{logoUrl:storage.publicUrlForKey(key)}});
}
