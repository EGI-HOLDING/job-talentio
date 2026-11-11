import assert from 'node:assert/strict';
import {escoTaskDictionary,projectTaskEvidence,taskCompatibility,taskEvidence,VACANCY_TASK_VERSION,vacancyTaskText} from './vacancy-tasks';

let passed=0;
const check=(value:unknown,message:string)=>{assert.ok(value,message);passed++;};
const dictionary=escoTaskDictionary([
  {uri:'esco:financial-reporting',label:'financial reporting',type:'skill',reuse:'occupation-specific'},
  {uri:'esco:stock-reconciliation',label:'stock reconciliation',type:'skill',reuse:'occupation-specific'},
  {uri:'esco:communication',label:'communication',type:'skill',reuse:'transversal'},
  {uri:'esco:general-knowledge',label:'general knowledge',type:'knowledge',reuse:'occupation-specific'},
  {uri:'http://data.europa.eu/esco/skill/graphics',label:'design graphics',aliases:['create graphic material'],type:'skill',reuse:'cross-sector'},
  {uri:'http://data.europa.eu/esco/skill/content',label:'develop digital content',type:'skill',reuse:'cross-sector'},
]);

check(VACANCY_TASK_VERSION.startsWith('vacancy-tasks-v5@'),'task evidence version advances so all published postings are re-read');
check(dictionary.match('Prepare monthly financial reporting').has('esco:financial-reporting'),'two-word occupation-specific ESCO task labels are searchable');
check(!dictionary.match('Clear communication skills').has('esco:communication'),'transversal skills are not treated as occupational tasks');

const unheaded=taskEvidence('Maintain stock control systems\nReconcile inventory\nCoordinate annual stock counts',dictionary);
check(unheaded.some(row=>row.key==='warehouse.stock'),'action-led responsibilities are extracted without a heading');
check(unheaded.every(row=>!row.excerpt.toLowerCase().includes('reconcile inventory')||row.key==='warehouse.stock'),'work evidence retains a matching source excerpt');

const headed=taskEvidence('Tanggung jawab utama:\n• Menyiapkan mise en place untuk layanan harian\n• Memasak menu sesuai standar\nPersyaratan:\n• Menyiapkan laporan penjualan bulanan',dictionary);
check(headed.some(row=>row.key==='culinary.prepare')&&headed.some(row=>row.key==='culinary.cook'),'Indonesian responsibilities and bullet lists are parsed');
check(!headed.some(row=>row.excerpt.toLowerCase().includes('laporan penjualan')),'requirements bullets do not become performed-task evidence');

const html=taskEvidence('<ul><li>Prepare ingredients for service</li><li>Cook menu items to order</li></ul>',dictionary);
check(html.some(row=>row.key==='culinary.prepare')&&html.some(row=>row.key==='culinary.cook'),'unheaded HTML list items retain their task boundaries');

const bounded=taskEvidence('Responsibilities: Maintain stock control systems. Requirements: Reconcile inventory.',dictionary);
check(bounded.length===1&&bounded[0]?.key==='warehouse.stock','inline requirements are excluded from responsibility evidence');

const excluded=taskEvidence('KPI:\nSet weekly sales targets\nNice to have:\nManage sales team',dictionary);
check(excluded.length===0,'KPI and nice-to-have sections are not vacancy task evidence');

const structured=vacancyTaskText({description:'Role overview',responsibilities:['Maintain stock control systems','Reconcile inventory']});
check(taskEvidence(structured,dictionary).some(row=>row.key==='warehouse.stock'),'structured responsibilities are included consistently');

const shared=taskCompatibility(['warehouse.stock','warehouse.receive'],['warehouse.stock','warehouse.receive']);
check(shared.strong&&!shared.conflict,'multiple concrete shared duties support a related-profession decision');
const generic=taskCompatibility(['sales.customer-needs'],['sales.order-records']);
check(!generic.strong,'a single unrelated task does not create a related-profession decision');
const design=projectTaskEvidence('Responsibilities\nDevelop visual concepts and create clear, engaging assets for digital stories.\nCollaborate across teams.',dictionary);
check(design.state==='PARTIAL'&&design.evidence.some(row=>row.key.endsWith('/graphics'))&&design.evidence.some(row=>row.key.endsWith('/content')),'real design duties are recognized while unknown clauses stay unknown');
const translated=taskEvidence('Tanggung jawab\nMembuat aset visual dan mengembangkan konten digital.',dictionary);
check(translated.length===2,'bilingual action and work product normalize to the same core concepts');
check(!taskEvidence('Responsibilities\nMust have experience with designing graphics.\nDoes not develop digital content.',dictionary).length,'requirements and negative statements are not duties');
check(!taskCompatibility(['sales.team-targets','sales.team-coaching'],['sales.customer-needs','sales.contracts'],new Set(['sales:lead']),'PARTIAL').conflict,'partial recognition does not treat absence as a contradiction');
const official=translated.map(task=>task.key);
const officialPolicy={specific:dictionary.specificKeys,primary:new Set(official.slice(0,1)),independent:dictionary.independent};
check(taskCompatibility(official,official,new Set(),'PARTIAL',officialPolicy).strong,'two core tasks with a documented output can recover a missing graph edge');
check(!taskCompatibility(official,official,new Set(),'RECOGNIZED',{...officialPolicy,primary:new Set()}).strong,'a shared method without a documented primary output cannot create a related edge');
check(dictionary.match('Create and edit graphics').has(official[0]!)||dictionary.match('Create and edit graphics').has(official[1]!),'coordinated verbs retain their shared work object');

console.log(JSON.stringify({suite:'vacancy-task-evidence',passed}));
