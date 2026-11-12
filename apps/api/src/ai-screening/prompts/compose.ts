import { interviewBoundaries } from './shared/interview-boundaries';
import { taraVoice } from './shared/tara-voice';
import { taraHumor } from './shared/tara-humor';
import { questionStyle } from './shared/question-style';
import { inputTrust } from './shared/input-trust';
import { jobRelevance } from './shared/job-relevance';
import { prepareJob } from './tasks/prepare-job';
import { PACKAGE_SCHEMA, conversationSchemas, type JsonSchema } from '../screening.schemas';
import { newConversationPolicy } from '../conversation.policy';
import { neutrality } from './shared/neutrality';
import { skillCandidate, skillTurn, timedCandidate, timedTurn, TIMED_TURN_SCHEMA } from './tasks/skill-interview';
import { freezeTakaInterview } from '../taka-interview';
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
    const messages = [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }];
    if (preset) return { ...preset, input: messages };
    if (task === 'evaluate') return { ...freezeTakaInterview(), input: messages };
    const policy = newConversationPolicy();
    const interviewing = [inputTrust, interviewBoundaries, taraVoice, taraHumor, questionStyle];
    const modules = task === 'prepare' ? [inputTrust, jobRelevance, prepareJob,
        'Urutkan kriteria dari tugas inti dan keahlian wajib ke tugas pendukung. Tanggung jawab terstruktur adalah sumber tugas. Jangan gunakan KPI atau nice-to-have sebagai syarat wajib.']
        : task === 'candidate' ? [...interviewing, skillCandidate, timedCandidate] : [...interviewing, skillTurn, timedTurn];
    return {
        input: messages, instructions: [neutrality, ...modules].join('\n\n'),
        schema: task === 'prepare' ? PACKAGE_SCHEMA : task === 'candidate' ? conversationSchemas(policy).candidate : TIMED_TURN_SCHEMA,
        name: 'tara_' + task.replace('-', '_'), version: policy.version, reasoning: 'none',
        maxOutput: task === 'prepare' ? 2600 : task === 'candidate' ? 3400 : 700,
    };
}
