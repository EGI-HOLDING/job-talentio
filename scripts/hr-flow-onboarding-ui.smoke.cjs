const {test}=require('node:test'),assert=require('node:assert/strict');
const {host,nodes}=require('./lib/react-hook-host.cjs');
const stub=()=>null;
test('legacy onboarding keeps its job and checkout after editing company, and completes through the server',async()=>{
 function Editor(){}
 const company={id:'company',name:'Legacy company',description:'An existing public company description.',profileSource:'MANUAL',industryGroups:[{code:'MANUFACTURING'}],size:'SIZE_11_50',city:{slug:'jakarta',province:{country:{id:'id'}}}};
 const progress={userId:'hr',status:'IN_PROGRESS',revision:0,flowVersion:1,step:2,companyId:'company',jobId:'existing-job',creationSessionId:null,memberships:[{companyId:'company',role:'OWNER',company}]};
 const job={id:'existing-job',companyId:'company',status:'DRAFT'};
 const calls=[],routes=[];let saved;
 const ui=host('apps/web/src/components/onboarding/RecruiterOnboardingV2.tsx','RecruiterOnboardingV2',{
  '@/lib/i18n/hr-flow':{useHrCopy:()=>text=>text},
  '@/lib/api':{api:async(route,options)=>{calls.push([route,options?.method]);if(route==='/meta/industry-groups')return {groups:[{code:'MANUFACTURING',name:'Manufacturing'}]};if(route==='/jobs/existing-job')return job;if(route==='/recruiter-onboarding/complete')return {status:'COMPLETE'};if(route==='/recruiter-onboarding')return progress;return company;},getSession:()=>({user:{id:'hr'}}),saveSession:value=>saved=value},
  '@/lib/navigation':{useRouter:()=>({replace:route=>routes.push(route)})},
  '@/lib/accountNavigation':{employerWorkspaceHref:()=>'/dashboard/recruiter?company=company'},
  '@/components/ui/LocationFields':{LocationFields:stub},'@/components/employee/WorkspacePrimitives':{WorkspaceLoading:stub},
  '@/components/recruiter/HrCreationFlow':{HrCreationFlow:stub,HrFlowHeader:stub},
  '@/components/recruiter/RecruiterJobEditorV2':{RecruiterJobEditorV2:Editor},
  '@/components/recruiter/useEmployerUnsaved':{useEmployerUnsaved(){}},
 },{document:{addEventListener(){},removeEventListener(){}},window:{scrollTo(){}}});
 let tree=await ui.render({});assert.equal(tree.type,Editor);assert.equal(tree.props.job.id,'existing-job');
 tree.props.onClose();tree=await ui.render();const form=nodes(tree,n=>n.type==='form')[0];
 const submitting=form.props.onSubmit({preventDefault(){}});await submitting;tree=await ui.render();
 for(let i=0;i<8&&tree.type!==Editor;i++)tree=await ui.render();
 assert.equal(tree.type,Editor);assert.equal(tree.props.job.id,'existing-job');assert.ok(!calls.some(([route])=>route.startsWith('/hr-flow/sessions')||route.startsWith('/job-commerce/orders')));
 await tree.props.onPublished('existing-job');assert.ok(calls.some(([route,method])=>route==='/recruiter-onboarding/complete'&&method==='POST'));assert.equal(saved.user.recruiterOnboarding.status,'COMPLETE');assert.equal(routes.at(-1),'/dashboard/recruiter?company=company');ui.unmount();
});
