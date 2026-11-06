'use client';
import { useI18n } from '@/lib/i18n';
/** Copy keys preserve Indonesian source text; translations live in the normal dictionary. */
export function useHrCopy(){
  const {t}=useI18n();
  return (text:string)=>{const key='hrFlow.'+text;const translated=t(key);return translated===key?text:translated;};
}
