import { Fragment } from 'react';
/** Plain text stays escaped. Only explicit HTTP(S) addresses become links. */
export function MessageBody({text}:{text:string}){
 const matches=[...text.matchAll(/https?:\/\/[^\s<>"']+/gi)];if(!matches.length)return <>{text}</>;
 const parts:Array<string|{href:string;text:string;external:boolean}>=[];let offset=0;
 for(const match of matches){const at=match.index!;parts.push(text.slice(offset,at));const raw=match[0],href=raw.replace(/[),.!?;:]+$/g,'');try{const url=new URL(href),external=typeof window==='undefined'||url.origin!==window.location.origin;parts.push({href,text:!external&&/^\/(?:[a-z]{2}\/)?screening\//.test(url.pathname)?'Buka undangan interview':href,external});parts.push(raw.slice(href.length));}catch{parts.push(raw);}offset=at+raw.length;}
 parts.push(text.slice(offset));return <>{parts.map((part,i)=>typeof part==='string'?<Fragment key={i}>{part}</Fragment>:<a key={i} href={part.href} {...(part.external?{target:'_blank',rel:'noopener noreferrer'}:{})}>{part.text}</a>)}</>;
}
