import { taraVoice } from './shared/tara-voice';
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
import { PACKAGE_SCHEMA, CANDIDATE_SCHEMA, FOLLOW_UP_SCHEMA, EVALUATION_SCHEMA, type JsonSchema } from '../screening.schemas';
import { SCREENING_PROMPT_VERSION } from '../screening.policy';
import { CLAIM_PROVIDER_SCHEMA } from '../evidence-catalog';
import { evidenceReferences } from './shared/evidence-references';
import { claimStatus } from './shared/claim-status';
import { claimScoring } from './shared/claim-scoring';
import { neutrality } from './shared/neutrality';
import { claimScoreExamples } from './examples/claim-scores';
export type ScreeningTask = 'prepare' | 'candidate' | 'follow-up' | 'evaluate';
export type PromptPreset = {
    instructions: string;
    schema: JsonSchema;
    name: string;
    version: string;
    reasoning: string;
    maxOutput: number;
    model?: string;
};
export function composePrompt(task: ScreeningTask, input: unknown, preset?: PromptPreset) {
    if (preset)
        return { ...preset, input: [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }] };
    const modules = task === 'prepare' ? [inputTrust, jobRelevance, prepareJob] :
        task === 'candidate' ? [inputTrust, cvSource, taraVoice, questionStyle, questionExample, prepareCandidate] :
            task === 'follow-up' ? [inputTrust, taraVoice, questionStyle, questionExample, followUp] :
                [inputTrust, evidenceRules, claimScoring, claimScoreExamples, evaluationExample, evaluateCandidate, evidenceReferences, claimStatus];
    modules.unshift(neutrality);
    return { instructions: modules.join('\n\n'), input: [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }],
        schema: task === 'prepare' ? PACKAGE_SCHEMA : task === 'candidate' ? CANDIDATE_SCHEMA : task === 'follow-up' ? FOLLOW_UP_SCHEMA : CLAIM_PROVIDER_SCHEMA,
        name: 'tara_' + task.replace('-', '_'), version: SCREENING_PROMPT_VERSION,
        reasoning: task === 'evaluate' ? 'low' : 'none', maxOutput: task === 'prepare' ? 2600 : task === 'candidate' ? 2800 : task === 'evaluate' ? 4500 : 240 };
}
