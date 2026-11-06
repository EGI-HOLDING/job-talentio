import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

export type VerifiedJobPayment = {
  orderId: string; eventId: string; reference: string; amount: number; currency: string;
  status?: 'PAID'|'PENDING'|'FAILED'|'CANCELLED'|'EXPIRED'|'REVIEW';
};
export type PaymentOrder = {id:string;amount:number;currency:string;createdAt:Date;expiresAt:Date};
const validId=(id:string)=>/^[a-zA-Z0-9_.~-]{1,50}$/.test(id);
export function midtransState(value:{transaction_status?:string;fraud_status?:string}):NonNullable<VerifiedJobPayment['status']>{
  if(value.transaction_status==='settlement'||value.transaction_status==='capture'&&value.fraud_status==='accept')return 'PAID';
  if(value.transaction_status==='pending'||value.transaction_status==='authorize')return 'PENDING';
  if(value.transaction_status==='expire')return 'EXPIRED';
  if(value.transaction_status==='cancel')return 'CANCELLED';
  if(['deny','failure'].includes(value.transaction_status??''))return 'FAILED';
  return 'REVIEW';
}
/** Backend-only Snap Redirect. A disabled new-checkout switch never disables
 * verification/reconciliation of payments already in progress. */
@Injectable()
export class JobPaymentProvider {
  readonly name:string=process.env.MIDTRANS_ENV==='production'?'midtrans-production':'midtrans-sandbox';
  readonly configured:boolean=['sandbox','production'].includes(process.env.MIDTRANS_ENV??'')&&Boolean(process.env.MIDTRANS_SERVER_KEY);
  readonly available:boolean=this.configured&&process.env.MIDTRANS_CHECKOUT_ENABLED==='true';
  private get production(){return process.env.MIDTRANS_ENV==='production';}
  private async request(url:string,body?:unknown){
    if(!this.configured)throw new ServiceUnavailableException('Payment gateway is not connected');
    let response:Response;
    try{response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Basic '+Buffer.from(process.env.MIDTRANS_SERVER_KEY+':').toString('base64')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}
    catch{throw new ServiceUnavailableException('Payment provider could not be reached. Check the order status before retrying.');}
    if(!response.ok)throw new ServiceUnavailableException('Payment provider request failed ('+response.status+'). Check the order status.');
    return response.json() as Promise<Record<string,any>>;
  }
  async checkout(order:PaymentOrder):Promise<{redirectUrl:string;reference:string}>{
    if(!this.available)throw new ServiceUnavailableException('New payment checkout is disabled');
    if(!validId(order.id)||order.currency!=='IDR'||!Number.isSafeInteger(order.amount)||order.amount<=0||order.expiresAt<=new Date())throw new BadRequestException('Invalid payment order');
    const domain=this.production?'app.midtrans.com':'app.sandbox.midtrans.com';
    const value=await this.request('https://'+domain+'/snap/v1/transactions',{
      transaction_details:{order_id:order.id,gross_amount:order.amount},credit_card:{secure:true},
      ...(process.env.WEB_URL?{callbacks:{finish:new URL('/id/checkout/'+order.id,process.env.WEB_URL).href}}:{}),
      expiry:{start_time:order.createdAt.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' +0000'),unit:'minutes',duration:Math.max(1,Math.floor((order.expiresAt.getTime()-order.createdAt.getTime())/60000))},
    });
    let target:URL|null=null;
    try{target=typeof value.redirect_url==='string'?new URL(value.redirect_url):null;}catch{}
    if(!target||target.protocol!=='https:'||target.hostname!==domain)throw new ServiceUnavailableException('Invalid checkout response');
    return {redirectUrl:target.href,reference:order.id};
  }
  async queryStatus(orderId:string):Promise<VerifiedJobPayment>{
    if(!validId(orderId))throw new BadRequestException('Invalid order');
    const value=await this.request('https://'+(this.production?'api.midtrans.com':'api.sandbox.midtrans.com')+'/v2/'+encodeURIComponent(orderId)+'/status');
    if(value.order_id!==orderId||typeof value.transaction_id!=='string'||!/^\d+(?:\.0{1,2})?$/.test(String(value.gross_amount)))throw new BadRequestException('Invalid provider status');
    if(process.env.MIDTRANS_MERCHANT_ID&&value.merchant_id&&value.merchant_id!==process.env.MIDTRANS_MERCHANT_ID)throw new BadRequestException('Merchant mismatch');
    const amount=Number(value.gross_amount),currency=value.currency??'IDR';
    if(!Number.isSafeInteger(amount)||currency!=='IDR')throw new BadRequestException('Invalid payment amount or currency');
    return {orderId,eventId:createHash('sha256').update([value.transaction_id,value.transaction_status,value.fraud_status??'',String(value.gross_amount)].join(':')).digest('hex'),reference:value.transaction_id,amount,currency,status:midtransState(value)};
  }
  async cancel(orderId:string){
    if(!validId(orderId))throw new BadRequestException('Invalid order');
    const current=await this.queryStatus(orderId);
    if(current.status!=='PENDING')return current;
    await this.request('https://'+(this.production?'api.midtrans.com':'api.sandbox.midtrans.com')+'/v2/'+encodeURIComponent(orderId)+'/cancel',{});
    return this.queryStatus(orderId);
  }
  async verify(_headers:Record<string,unknown>,rawBody:Buffer):Promise<VerifiedJobPayment>{
    if(!this.configured)throw new ServiceUnavailableException('Payment gateway is not connected');
    if(rawBody.length>65536)throw new BadRequestException('Invalid payment notification');
    let value:Record<string,unknown>;
    try{value=JSON.parse(rawBody.toString('utf8'));}catch{throw new BadRequestException('Invalid payment notification');}
    if(!value||typeof value.order_id!=='string'||!validId(value.order_id)||typeof value.status_code!=='string'||typeof value.gross_amount!=='string'||typeof value.signature_key!=='string'||!/^[a-fA-F0-9]{128}$/.test(value.signature_key))throw new BadRequestException('Invalid payment notification');
    const expected=createHash('sha512').update(value.order_id+value.status_code+value.gross_amount+process.env.MIDTRANS_SERVER_KEY).digest();
    if(!timingSafeEqual(expected,Buffer.from(value.signature_key,'hex')))throw new BadRequestException('Invalid payment signature');
    return this.queryStatus(value.order_id);
  }
}
