'use client';
import { useEmployeeIntentText } from '@/lib/i18n/employeeIntent';
import { Link } from '@/lib/navigation';
import type { EmployeeRecommendationState as State, EmployeeEvidenceState, EmployeeEmptyReason, MatchInsights } from '@job-talentio/shared';
export function EmployeeRecommendationNotice({ state, evidenceState, preferenceWarnings, emptyReason }: {
    state: State; evidenceState?:EmployeeEvidenceState;preferenceWarnings?:string[];emptyReason?:EmployeeEmptyReason;
}) {
    const m = useEmployeeIntentText();
    const preference = state.startsWith('PREFERENCES');
    const href = preference ? '/dashboard/employee?tab=profile&section=preferences' : '/dashboard/employee?tab=profile&section=cvs';
    const evidenceIncomplete=!!evidenceState&&evidenceState!=='READY';
    if(state==='READY'&&!evidenceIncomplete&&!preferenceWarnings?.length)return null;
    return <div className="card" role="status">{state!=='READY'&&<p>{m(emptyReason?`empty.${emptyReason}`:`state.${state}`)}</p>}{state==='READY'&&evidenceIncomplete&&<>{evidenceState!=='REVIEW_REQUIRED'&&<p>{m('preferencesBased')}</p>}<p>{m(`evidence.${evidenceState}`)}</p><Link href="/dashboard/employee?tab=profile&section=cvs">{m('openMyCVs')}</Link></>}{!!preferenceWarnings?.length&&<p><Link href="/dashboard/employee?tab=profile&section=preferences">{m('partialPreferences')}</Link></p>}{state !== 'READY' && <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{!['UNAVAILABLE', 'NO_ELIGIBLE_JOBS', 'CV_PROCESSING'].includes(state) && <Link href={href}>{preference ? (m("editPositionPreferences")) : (m("openMyCVs"))}</Link>}{state==='NO_ELIGIBLE_JOBS'?<Link className="secondary" href="/jobs?mode=exploration">{m("exploreOtherJobs")}</Link>:<Link href="/jobs?mode=all">{m("exploreAllJobs")}</Link>}</nav>}</div>;
}
export function EmployeeMatchReasons({ insights }: {
    insights?: MatchInsights | null;
}) {
    const m = useEmployeeIntentText();
    if(insights?.mode==='EXPLORATION')return null;
    if (insights?.version !== 'employee-intent-v3.2')
        return null;
    const relevant = insights.evidence.filter(e => (e.status === 'MET' && ['ROLE', 'SKILL', 'EXPERIENCE'].includes(e.kind)) || e.code==='TRANSFERABLE_EXPERIENCE');
    const fit=insights.practicalFit;
    const practical=fit?.active?[fit.country==='UNMET'?m('countryOutside'):fit.country==='UNKNOWN'?m('countryUnknown'):null,fit.salary==='UNKNOWN'?m('salaryUnknown'):fit.salary==='UNMET'?m('salaryBelow'):fit.salary==='MET'?m(fit.salaryReason==='UPPER_BOUND_MEETS'?'salaryPossible':'salaryMeets'):null].filter(Boolean):[];
    const unknown = insights.evidence.some(e => e.required && e.status === 'UNKNOWN');
    const unmet = insights.evidence.some(e => e.required && e.status === 'UNMET');
    return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12, marginTop: 6 }}>{practical.map((text,i)=><span key={'practical-'+i}>{text}</span>)}{relevant.slice(0, 2).map((e, i) => <span className="badge" key={i}>{e.kind === 'ROLE' ? e.code==='RELATED_ROLE'?m('relatedPosition')+e.label:m("selectedPositionMatches") : e.kind === 'EXPERIENCE' ? e.code==='TRANSFERABLE_EXPERIENCE'?m('transferableExperience'):(m("relevantExperience")) : (m("skillMatch")) + e.label}</span>)}{insights.relatedTasks?.[0]&&<span>{m('sharedTask')} &#xb7; {insights.relatedTasks[0]}</span>}{insights.mode==='PREFERENCES_BASED'&&<span>{m('preferencesBased')}</span>}{unknown && <span>{m("someEvidenceIsIncomplete")}</span>}{unmet && <span>{m("someRequirementsAreNotYetMet")}</span>}</div>;
}
export function EmployeeExplorationNotice(){const m=useEmployeeIntentText();return <div role="status"><strong>{m('explorationTitle')}</strong><p>{m('explorationCopy')}</p></div>;}

export function EmployeeCountryPreferenceNotice({policy}:{policy?:{active:boolean;countryFilterApplied:boolean}}){
 const m=useEmployeeIntentText();
 return policy?.active&&!policy.countryFilterApplied?<p><Link href="/dashboard/employee?tab=profile&section=preferences">{m('countryMissing')}</Link></p>:null;
}
