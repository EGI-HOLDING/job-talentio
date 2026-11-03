import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {makeRelatedBenchmark,relatedBenchmarkRank} from '../matching/employee-related-benchmark';
import {evaluateHumanLabels} from '../matching/employee-intent.benchmark';
import {employeeBenchmarkReviewHtml} from '../matching/employee-benchmark-review';
import {recommendationGateAccepted} from '../matching/employee-recommendation-policy';

const directory=process.argv[2];if(!directory)throw Error('Usage: employee-related-review OUTPUT_DIRECTORY [--validate]');
const dataset=makeRelatedBenchmark(),datasetHash=createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
const coverageFile=path.join(directory,'catalog-applied.json'),coverage=JSON.parse(fs.readFileSync(coverageFile,'utf8'));
if(process.argv.includes('--validate')){
 const labels=JSON.parse(fs.readFileSync(path.join(directory,'human-labels.json'),'utf8'));
 const performance=JSON.parse(fs.readFileSync(path.join(directory,'integration-report.json'),'utf8'));
 if(labels.snapshotHash!==coverage.snapshotHash||!coverage.coverage.every((r:any)=>labels.coverageReviewedRoleIds?.includes(r.roleId)))throw Error('Every occupation in the locked snapshot needs an independent coverage review');
 const report={...evaluateHumanLabels(dataset,labels,performance.suite==='employee-related-v32-real-db'&&performance.falseEmptyCount===0&&performance.baselineP95Ms>0&&performance.currentP95Ms>0&&performance.currentP95Ms<=performance.baselineP95Ms*1.2,relatedBenchmarkRank),policyVersion:'related-roles-v32',coverageReviewed:true,falseEmptyCount:performance.falseEmptyCount,snapshotHash:coverage.snapshotHash};
 fs.writeFileSync(path.join(directory,'quality-gate-report.json'),JSON.stringify({...report,accepted:recommendationGateAccepted(report)},null,2));
 if(!recommendationGateAccepted(report))throw Error('Independent quality thresholds have not passed');
 console.log('Independent review accepted; report generated. No production activation performed.');
}else{
 const template={datasetHash,snapshotHash:coverage.snapshotHash,reviewedBy:null,reviewedAt:null,coverageReviewedRoleIds:[],profiles:dataset.profiles.map(p=>({id:p.id,split:p.split,eligibleJobIds:[],grades:Object.fromEntries(dataset.jobs.map(j=>[j.id,null]))}))};
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'dataset.json'),JSON.stringify(dataset,null,2));
 if(!fs.existsSync(path.join(directory,'human-labels.json')))fs.writeFileSync(path.join(directory,'human-labels.json'),JSON.stringify(template,null,2));
 const data=JSON.stringify(coverage.coverage).replace(/</g,'\\u003c');
 const extra=`<section id="coverage"><h2>Occupation coverage review</h2><p>Review every listed occupation. A lack of curated relations requires checking for relevant active opportunities; a checkbox is not evidence of relevance.</p></section><script>const coverageRows=${data};const section=document.getElementById('coverage');coverageRows.forEach(row=>{const line=document.createElement('label');line.style.display='block';const box=document.createElement('input');box.type='checkbox';box.checked=labels.coverageReviewedRoleIds?.includes(row.roleId)||false;box.onchange=()=>{const ids=new Set(labels.coverageReviewedRoleIds||[]);if(box.checked)ids.add(row.roleId);else ids.delete(row.roleId);labels.coverageReviewedRoleIds=[...ids];save();};line.append(box,document.createTextNode(row.name+' — '+row.decision+'; exact active: '+row.exactActive+'; related active: '+row.relatedActive.length));section.append(line);});</script>`;
 fs.writeFileSync(path.join(directory,'human-review.html'),employeeBenchmarkReviewHtml(dataset,template).replace('</body>',extra+'</body>'));
 console.log(JSON.stringify({datasetHash,profiles:dataset.profiles.length,coverage:coverage.coverage.length,humanValidated:false}));
}
