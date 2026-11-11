import { createHash } from 'node:crypto';

/** Deterministic task vocabulary. No candidate data, network, or model is used. */
export const TASK_CONCEPT_VERSION = 'task-concepts-v2';
export type TaskSkill = { uri: string; label: string; type: string; reuse: string; aliases?: string[]; description?: string; broader?: string[]; groups?: string[] };
export type TaskKind = 'TASK' | 'TOOL' | 'KNOWLEDGE' | 'GENERAL' | 'UNCLASSIFIED';
const generic = /^(?:communicate|work in (?:an? [\w -]+ )?teams?|work independently|manage time|meet deadlines|follow a brief|follow instructions|follow work schedule|develop creative ideas|brainstorm ideas|identify customer.?s? needs|meet expectations|finish project within budget|apply health and safety|maintain professional|use office|use word processing|use presentation|listen actively|have computer literacy|empathi[sz]e|ensure client orientation|maintain customer service|maintain relationship with customers|contribute to continuity of health care|apply HACCP|apply requirements concerning|comply with food safety|deal with emergency (?:care )?situations|support local tourism|create solutions to problems|develop professional network|consult information sources|use technical documentation|apply safe work practices|apply statistical analysis techniques|apply scientific methods|manage (?:research data|findable accessible interoperable and reusable data)|manage personal professional development)/i;
const tool = /(?:\bsoftware\b|\bprogramming languages?\b|\bcomputer tools?\b|\bcreative suite\b|\bCAD\b|\bspreadsheet\b)/i;

export function taskKind(skill: TaskSkill): TaskKind {
  if (skill.type === 'knowledge') return 'KNOWLEDGE';
  if (skill.type !== 'skill') return 'UNCLASSIFIED';
  if (tool.test(skill.label)&&!/^(?:develop|design|build|install|maintain|test|configure|integrate|implement|repair|verify|deploy|analyse|analyze)\s/i.test(skill.label)) return 'TOOL';
  if (skill.reuse === 'transversal' || generic.test(skill.label)) return 'GENERAL';
  return ['occupation-specific','sector-specific','cross-sector'].includes(skill.reuse) ? 'TASK' : 'UNCLASSIFIED';
}

// These are action equivalences within a task, never occupation/title aliases.
const actionGroups = [
  ['create','design','develop','build','produce','make','author','merancang','mendesain','membuat','mengembangkan','membangun','menghasilkan'],
  ['edit','modify','adapt','adjust','refine','revise','mengedit','menyunting','menyesuaikan','memperbarui'],
  ['inspect','check','verify','memeriksa','mengecek','memverifikasi'],
  ['assess','evaluate','analyse','analyze','menilai','mengevaluasi','menganalisis'],
  ['manage','administer','mengelola'], ['lead','supervise','oversee','memimpin','mengawasi'],
  ['prepare','menyiapkan','mempersiapkan'], ['maintain','preserve','memelihara','merawat'],
  ['repair','fix','memperbaiki'], ['install','memasang'], ['operate','mengoperasikan'],
  ['teach','instruct','mengajar'], ['train','coach','melatih','membina'],
  ['monitor','memantau'], ['record','document','mencatat','mendokumentasikan'],
  ['deliver','provide','supply','memberikan','menyediakan','menyampaikan'],
  ['research','investigate','meneliti'], ['negotiate','menegosiasikan'],
  ['cook','memasak'], ['serve','melayani'], ['plan','schedule','merencanakan','menjadwalkan'],
  ['test','menguji'], ['use','utilise','utilize','menggunakan'], ['apply','menerapkan'],
  ['perform','conduct','carry','melakukan','melaksanakan'], ['organize','organise','mengatur'],
] as const;
const actions = new Map<string,string>(actionGroups.flatMap(group=>group.map(term=>[term,group[0]] as [string,string])));
const fillers = new Set('a an the of for to and or with in on by as into through from relevant clear engaging polished appropriate different required intended final various main core work working activities activity techniques technique processes process'.split(' '));
const singular:Record<string,string> = { images:'image',graphics:'graphic',assets:'asset',concepts:'concept',stories:'story',formats:'format',platforms:'platform',requirements:'requirement',briefs:'brief',customers:'customer',accounts:'account',products:'product',systems:'system',applications:'application',children:'child',people:'person',media:'media',data:'data' };
export function taskTokens(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
    .replace(/\b(?:visual (?:concepts?|assets?|content)|graphic designs?|desain grafis|aset visual|konsep visual|konten visual)\b/g, ' graphic ')
    .replace(/\b(?:digital (?:stories|assets|content)|konten digital)\b/g, ' digital content ')
    .replace(/\b(?:photographs?|photos?|gambar|foto)\b/g, ' image ')
    .replace(/\b(?:pengeditan|penyuntingan)\b/g, ' edit ');
  return (normalized.match(/[\p{L}\p{N}+#]+/gu) ?? []).map(word=>{
    if(actions.has(word))return actions.get(word)!;
    if(singular[word])return singular[word];
    // Inflection only; do not stem profession identities or derive synonyms.
    if(word.endsWith('ing')) { const stem=word.slice(0,-3); if(actions.has(stem))return actions.get(stem)!; if(actions.has(stem+'e'))return actions.get(stem+'e')!; }
    if(word.endsWith('ed')) { const stem=word.slice(0,-2); if(actions.has(stem))return actions.get(stem)!; if(actions.has(stem+'e'))return actions.get(stem+'e')!; }
    return word.length>4&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
  }).filter(word=>!fillers.has(word));
}

const contextOnlyObject = new Set('data datum statistic statistical analysis information source result problem solution task method document documentation process parameter procedure practice equipment material system standard staff team safety welfare quality plan schedule strategy budget record report network project relationship resource condition temperature health service activity technique'.split(' '));
export function hasSpecificTaskOutput(skill:TaskSkill) {
  const tokens=taskTokens(skill.label);
  return taskKind(skill)==='TASK'&&tokens.length>=2&&actions.has(tokens[0]!)&&tokens.slice(1).some(token=>!actions.has(token)&&!contextOnlyObject.has(token));
}

export function independentTaskIds(ids:Iterable<string>,byUri:ReadonlyMap<string,TaskSkill>):string[] {
  const unique=new Set(ids),broader=new Set<string>();
  for(const id of unique)for(const parent of byUri.get(id)?.broader??[])if(parent!==id&&unique.has(parent))broader.add(parent);
  return [...unique].filter(id=>!broader.has(id));
}

type Entry = { key: string; tokens: string[]; action?: string; objects: string[] };
const literalTokens=(text:string)=>text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}+#]+/gu)??[];
export function buildTaskDictionary(skills: readonly TaskSkill[]) {
  const entries:Entry[]=[];
  const keys=new Set<string>();
  const specificKeys=new Set<string>();
  const classifications:Record<TaskKind,number>={TASK:0,TOOL:0,KNOWLEDGE:0,GENERAL:0,UNCLASSIFIED:0};
  const starts=new Map<string,Entry[]>(),objects=new Map<string,Entry[]>();
  const literalStarts=new Map<string,Entry[]>(),literalOwners=new Map<string,Set<string>>();
  const labels=new Map<string,Set<string>>(),byUri=new Map(skills.map(skill=>[skill.uri,skill]));
  for(const skill of skills){
    const kind=taskKind(skill); classifications[kind]++;
    if(kind!=='TASK')continue;
    keys.add(skill.uri);
    if(hasSpecificTaskOutput(skill))specificKeys.add(skill.uri);
    for(const label of [skill.label,...skill.aliases??[]]){
      const literal=literalTokens(label);
      if(literal.length>=2){
        const surface=literal.join(' '),owners=literalOwners.get(surface)??new Set<string>();
        owners.add(skill.uri);literalOwners.set(surface,owners);
        const index=literalStarts.get(literal[0]!)??[];index.push({key:skill.uri,tokens:literal,objects:[]});literalStarts.set(literal[0]!,index);
      }
      const tokens=taskTokens(label); if(tokens.length<2)continue;
      const action=actions.has(tokens[0]!)?actions.get(tokens[0]!):undefined;
      const nouns=tokens.slice(action?1:0).filter(t=>!actions.has(t));
      const entry={key:skill.uri,tokens,action,objects:nouns};entries.push(entry);
      const surface=tokens.join(' '),owners=labels.get(surface)??new Set<string>();owners.add(skill.uri);labels.set(surface,owners);
      const exact=starts.get(tokens[0]!)??[];exact.push(entry);starts.set(tokens[0]!,exact);
      if(action&&nouns.length) { const candidates=objects.get(nouns[0]!)??[];candidates.push(entry);objects.set(nouns[0]!,candidates); }
    }
  }
  const uniqueLabel=(entry:Entry,allowed?:ReadonlySet<string>)=>{
    const owners=labels.get(entry.tokens.join(' '));
    return allowed?allowed.has(entry.key)&&!!owners&&[...owners].filter(id=>allowed.has(id)).length===1:owners?.size===1;
  };
  return {keys,specificKeys,classifications,independent:(ids:Iterable<string>)=>independentTaskIds(ids,byUri),revision:createHash('sha256').update(JSON.stringify([TASK_CONCEPT_VERSION,entries])).digest('hex'),match(text:string,allowed?:ReadonlySet<string>){
    const result=new Set<string>();
    // Do not connect actions and objects across clauses or list boundaries.
    for(const clause of text.split(/[;.!?]|\b(?:but|whereas|tetapi|sedangkan)\b/iu)){
      const literal=literalTokens(clause);
      for(let i=0;i<literal.length;i++){
        for(const entry of literalStarts.get(literal[i]!)??[]){
          if(allowed&&!allowed.has(entry.key))continue;
          const owners=literalOwners.get(entry.tokens.join(' '))!;
          if((allowed?[...owners].filter(id=>allowed.has(id)).length===1:owners.size===1)&&entry.tokens.every((word,n)=>literal[i+n]===word))result.add(entry.key);
        }
      }
      const tokens=taskTokens(clause);
      for(let i=0;i<tokens.length;i++){
        for(const entry of starts.get(tokens[i]!)??[])if(uniqueLabel(entry,allowed)&&entry.tokens.every((word,n)=>tokens[i+n]===word))result.add(entry.key);
        for(const entry of objects.get(tokens[i]!)??[]){
          if(!entry.action||!specificKeys.has(entry.key)||!uniqueLabel(entry,allowed))continue;
          const preceding=tokens.slice(Math.max(0,i-5),i);
          const last=preceding.map(word=>actions.has(word)).lastIndexOf(true);
          if(last<0)continue;
          // Coordinated verbs can share an object ("create and edit graphics").
          let start=last;
          while(start>0&&actions.has(preceding[start-1]!))start--;
          if(!preceding.slice(start,last+1).includes(entry.action))continue;
          const span=tokens.slice(i,i+Math.min(9,entry.objects.length+4));
          const nextAction=span.findIndex((word,n)=>n>0&&actions.has(word));
          if(nextAction>=0)span.splice(nextAction);
          if(entry.objects.every(word=>span.includes(word)))result.add(entry.key);
        }
      }
    }
    return new Set(independentTaskIds(result,byUri));
  }};
}
