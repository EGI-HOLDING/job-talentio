import assert from 'node:assert/strict';
import {escoTaskDictionary,taskCompatibility,taskEvidence,VACANCY_TASK_VERSION,vacancyTaskText} from './vacancy-tasks';

let passed=0;
const check=(value:unknown,message:string)=>{assert.ok(value,message);passed++;};
const dictionary=escoTaskDictionary([
  {uri:'esco:financial-reporting',label:'financial reporting',type:'skill',reuse:'occupation-specific'},
  {uri:'esco:stock-reconciliation',label:'stock reconciliation',type:'skill',reuse:'occupation-specific'},
  {uri:'esco:communication',label:'communication',type:'skill',reuse:'transversal'},
  {uri:'esco:general-knowledge',label:'general knowledge',type:'knowledge',reuse:'occupation-specific'},
]);

check(VACANCY_TASK_VERSION==='vacancy-tasks-v4','task evidence version advances so all published postings are re-read');
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

console.log(JSON.stringify({suite:'vacancy-task-evidence',passed}));
