import { LinkedInFailure } from './linkedin-client';

export const LINKEDIN_ENDPOINTS = ['imageInitialize','imageUpload','imageRead','posts'] as const;
export const LATENCY_BUCKETS = [250,1000,5000,20000] as const;
export type LinkedInRequestMetric = { endpoint:typeof LINKEDIN_ENDPOINTS[number]; durationMs:number; status:number | null };
export type LinkedInTelemetry = (metric:LinkedInRequestMetric) => Promise<void>;

/** Configuration is an internal safety ceiling, never a provider quota claim. */
export function endpointLimits(raw:string,endpoint:string) {
  try {
    const configured:unknown=JSON.parse(raw);
    if(!configured || typeof configured!=='object' || Array.isArray(configured))throw Error();
    const limits=(configured as Record<string,unknown>)[endpoint] ?? {};
    if(!limits || typeof limits!=='object' || Array.isArray(limits))throw Error();
    const values=limits as Record<string,unknown>;
    if(Object.entries(values).some(([key,value])=>!['app','member'].includes(key) || typeof value!=='number' || !Number.isSafeInteger(value) || value<1))throw Error();
    return {app:Math.min(1000000,values.app as number ?? 10000),member:Math.min(10000,values.member as number ?? 100)};
  }catch {throw new LinkedInFailure('CONFIGURATION_ERROR','The sharing quota configuration needs attention.');}
}
