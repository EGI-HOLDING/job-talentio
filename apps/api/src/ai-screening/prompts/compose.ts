import { interviewBoundaries } from './shared/interview-boundaries';
import { taraVoice } from './shared/tara-voice';
import { taraHumor } from './shared/tara-humor';
import { conversationOpening } from './shared/conversation-opening';
import { CURRENT_CONVERSATION, assessmentVersion, usesSkillInterview, usesTimedInterview, type ConversationPolicy } from '../conversation.policy';
import { questionStyle } from './shared/question-style';
import { inputTrust } from './shared/input-trust';
import { jobRelevance } from './shared/job-relevance';
import { cvSource } from './shared/cv-source';
import { evidenceRules } from './shared/evidence-rules';
import { questionExample } from './examples/questions';
import { evaluationExample } from './examples/evaluation';
import { prepareJob } from './tasks/prepare-job';
import { prepareCandidate } from './tasks/prepare-candidate';
import { followUp } from './tasks/follow-up';
import { evaluateCandidate } from './tasks/evaluate-candidate';
import { PACKAGE_SCHEMA, conversationSchemas, type JsonSchema } from '../screening.schemas';
import { SCREENING_PROMPT_VERSION } from '../screening.policy';
import { CLAIM_PROVIDER_SCHEMA, JUDGED_CLAIM_PROVIDER_SCHEMA } from '../evidence-catalog';
import { evidenceReferences } from './shared/evidence-references';
import { claimStatus } from './shared/claim-status';
import { claimScoring } from './shared/claim-scoring';
import { neutrality } from './shared/neutrality';
import { claimJudgement } from './shared/claim-judgement';
import { assessmentConsistency } from './shared/assessment-consistency';
import { claimScoreExamples } from './examples/claim-scores';
import { cvAssessment } from './shared/cv-assessment';
import { scoreCv } from './tasks/score-cv';
import { cvScoreExample } from './examples/cv-score';
import { CV_RESULT_SCHEMA, CV_SCORING_VERSION } from '../recruitment/cv-scoring.policy';
import { skillCandidate, skillTurn, timedCandidate, timedTurn, SKILL_TURN_SCHEMA, TIMED_TURN_SCHEMA } from './tasks/skill-interview';
export type ScreeningTask = 'prepare' | 'candidate' | 'follow-up' | 'evaluate' | 'cv-score';
export type PromptPreset = {
    instructions: string;
    schema: JsonSchema;
    name: string;
    version: string;
    reasoning: string;
    maxOutput: number;
    model?: string;
};
export function composePrompt(task: ScreeningTask, input: unknown, preset?: PromptPreset, policy: ConversationPolicy = CURRENT_CONVERSATION) {
    if (preset)
        return { ...preset, input: [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }] };
    if (task === 'cv-score') return { instructions: [inputTrust, cvAssessment, scoreCv, cvScoreExample].join('\n\n'), input: [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }], schema: CV_RESULT_SCHEMA, name: 'talentio_cv_score', version: CV_SCORING_VERSION, reasoning: 'low', maxOutput: 16000 };
    const skillInterview = usesSkillInterview(policy);
    const timed = usesTimedInterview(policy);
    const modules = task === 'prepare' ? [inputTrust, jobRelevance, prepareJob, ...(skillInterview ? [
        'Urutkan kriteria dari tugas inti dan keahlian wajib ke tugas pendukung. Tanggung jawab terstruktur adalah sumber tugas. Jangan gunakan KPI atau nice-to-have sebagai syarat wajib.',
    ] : [])] :
        skillInterview && task === 'candidate' ? [inputTrust, interviewBoundaries, taraVoice, taraHumor, questionStyle, skillCandidate, ...(timed ? [timedCandidate] : [])] :
        skillInterview && task === 'follow-up' ? [inputTrust, interviewBoundaries, taraVoice, taraHumor, questionStyle, skillTurn, ...(timed ? [timedTurn] : [])] :
        task === 'candidate' ? [inputTrust, interviewBoundaries, cvSource, taraVoice, taraHumor, questionStyle, questionExample, prepareCandidate, conversationOpening] :
            task === 'follow-up' ? [inputTrust, interviewBoundaries, taraVoice, taraHumor, questionStyle, questionExample, followUp] :
                [inputTrust, evidenceRules, claimScoring, claimScoreExamples, evaluationExample, evaluateCandidate, evidenceReferences, claimStatus];
    if (task === 'evaluate' && policy.probeOrder === 'breadth-first') modules.push(assessmentConsistency, claimJudgement);
    modules.unshift(neutrality);
    const schemas = conversationSchemas(policy);
    return { instructions: modules.join('\n\n'), input: [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }],
        schema: task === 'prepare' ? PACKAGE_SCHEMA : task === 'candidate' ? schemas.candidate : task === 'follow-up' ? timed ? TIMED_TURN_SCHEMA : skillInterview ? SKILL_TURN_SCHEMA : schemas.followUp : policy.probeOrder === 'breadth-first' ? JUDGED_CLAIM_PROVIDER_SCHEMA : CLAIM_PROVIDER_SCHEMA,
        name: 'tara_' + task.replace('-', '_'), version: task === 'evaluate' ? assessmentVersion(policy) : policy.version,
        reasoning: task === 'evaluate' ? 'low' : 'none', maxOutput: task === 'prepare' ? 2600 : task === 'candidate' ? (policy.maxCore > 5 ? 7200 : timed ? 3400 : 2800) : task === 'evaluate' ? (policy.maxCore > 5 ? 6500 : 4500) : timed ? 700 : 240 };
}
