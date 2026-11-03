import {catalogTitleIdentityKey as key} from '../common/title-resolve';
/** Discovery suggestions require a click; they never change persisted identities. */
export function positionSuggestionScore(query:string,label:string){
 const q=key(query),s=key(label);
 if(!q)return 1;
 if(q===s)return 100;
 if(s.includes(q))return 80-Math.min(20,(s.length-q.length)/10);
 if(q.length<3||q.length>64||s.length>128)return 0;
 const grams=(text:string)=>new Set(Array.from({length:Math.max(0,text.length-1)},(_,i)=>text.slice(i,i+2)));
 const a=grams(q),b=grams(s),overlap=[...a].filter(g=>b.has(g)).length;
 const dice=2*overlap/(a.size+b.size||1);
 return dice>=0.55?dice*50:0;
}
