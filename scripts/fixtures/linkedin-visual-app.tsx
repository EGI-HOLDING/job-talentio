import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LinkedInSharePreview} from '../../apps/web/src/components/recruiter/LinkedInSharePreview';
import {LinkedInIntegrationPanel} from '../../apps/web/src/components/recruiter/LinkedInIntegrationPanel';
import {ConfirmProvider} from '../../apps/web/src/components/ui/ConfirmProvider';
import '../../apps/web/src/app/globals.css';

function App(){
  const query=new URLSearchParams(location.search),scenario=query.get('scenario') || 'preview';
  const [intent,setIntent]=useState(false),[approval,setApproval]=useState<string|null>(null);
  const long=query.get('long')==='1';
  return <main style={{padding:20,width:'100%',maxWidth:query.get('narrow')?'620px':'1040px',margin:'0 auto'}}>
    <h1 style={{fontSize:22}}>Job Talentio</h1><p style={{color:'#53617a'}}>Pemeriksaan lokal · data contoh</p>
    {scenario.startsWith('settings') || ['disabled','expired','revoked','disconnected'].includes(scenario)?<LinkedInIntegrationPanel/>:<>
      <LinkedInSharePreview jobId="fixture-job" title={long?'Senior Frontend Developer untuk Platform Rekrutmen Internasional dan Pengalaman Pengguna Multibahasa':'Senior Frontend Developer'} companyName={long?'TalentioInternationalRecruitmentAndEmploymentServicesCorporation':'Talentio Design Studio'} location="Jakarta, Indonesia" workMode="HYBRID" employmentType="FULL_TIME" draftKey="fixture-1" published={['unknown','unknown-wait','failed','queued','publishing','published','share'].includes(scenario)} onShareIntentChange={setIntent} onApprovalChange={setApproval}/>
      {['preview','prepare-failure'].includes(scenario)&&<p role="status" data-testid="fixture-approval">{intent?(approval?'Pratinjau disetujui untuk publikasi':'Tinjau pratinjau sebelum publikasi'):'Berbagi LinkedIn belum dipilih'}</p>}
    </>}
  </main>;
}
createRoot(document.getElementById('app')!).render(<ConfirmProvider><App/></ConfirmProvider>);
