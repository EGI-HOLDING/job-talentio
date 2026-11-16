import { interviewBoundaries } from './shared/interview-boundaries';
import { taraVoice } from './shared/tara-voice';
import { taraHumor } from './shared/tara-humor';
import { questionStyle } from './shared/question-style';
import { inputTrust } from './shared/input-trust';
import { jobRelevance } from './shared/job-relevance';
import { prepareJob } from './tasks/prepare-job';
import { PACKAGE_SCHEMA, type JsonSchema } from '../screening.schemas';
import { newConversationPolicy } from '../conversation.policy';
import { neutrality } from './shared/neutrality';
import { skillTurn, timedTurn, TIMED_TURN_SCHEMA } from './tasks/skill-interview';
import { freezeTakaInterview } from '../taka-interview';
import { CANDIDATE_REFERENCES_SCHEMA } from '../candidate-preparation';
import type { AssessmentLanguage } from '@job-talentio/shared';
export type ScreeningTask = 'prepare' | 'candidate' | 'follow-up' | 'evaluate' | 'live-agenda' | 'assessment-narrative';
export type PromptPreset = {
    instructions: string;
    schema: JsonSchema;
    name: string;
    version: string;
    reasoning: string;
    maxOutput: number;
    model?: string;
};
export function composePrompt(task: ScreeningTask, input: unknown, preset?: PromptPreset, assessmentLanguage?: AssessmentLanguage) {
    const messages = [{ role: 'user', content: 'DATA_INPUT\n' + JSON.stringify(input) }];
    if (preset) return { ...preset, input: messages };
    if (task === 'evaluate') return { ...freezeTakaInterview(assessmentLanguage), input: messages };
    if (task === 'assessment-narrative') throw new Error('MISSING_ASSESSMENT_NARRATIVE_PROMPT');
    if (task === 'live-agenda') throw new Error('MISSING_LIVE_AGENDA_PROMPT');
    const policy = newConversationPolicy();
    const interviewing = [inputTrust, interviewBoundaries, ...(assessmentLanguage === 'en'
        ? ['You are Tara, a friendly and direct Talentio interviewer. Speak to the candidate only in natural English. Ask one concrete question at a time and use the supplied interview context. Understand answers in any language. Keep names and technical terms faithful to the source. Avoid giving a verdict or praise for the quality of answers.']
        : [taraVoice, taraHumor]), questionStyle];
    const modules = task === 'prepare' ? [inputTrust, jobRelevance, prepareJob,
        'Urutkan kriteria dari tugas inti dan keahlian wajib ke tugas pendukung. Tanggung jawab terstruktur adalah sumber tugas. Jangan gunakan KPI atau nice-to-have sebagai syarat wajib.']
        : task === 'candidate' ? [inputTrust, jobRelevance,
            'Pilih maksimal delapan usulan keahlian yang benar-benar tertulis di cvSegments dan relevan untuk lowongan. Isi sourceRef dengan ID segmen dan skillText dengan nama keahlian yang persis tercantum dalam segmen itu. Isi criterionId dari job.criteria. Utamakan keahlian wajib dan tugas inti (CORE), lalu tugas pendukung (SUPPORTING). Satu usulan per keahlian, termasuk sinonim. Abaikan sebutan yang hanya muncul dalam negasi. Jika tidak ada keahlian relevan, kembalikan claims kosong. Jangan menulis kutipan, pertanyaan, atau konteks baru.']
            : [...interviewing, skillTurn, timedTurn];
    return {
        input: messages, instructions: [neutrality, ...modules,
            ...(assessmentLanguage === 'en' && task !== 'candidate' ? ['Write all candidate-facing questions and greeting text in English, even when the CV, job or response is in Indonesian or another language. Keep reference IDs and any verbatim answer evidence unchanged.'] : []),
        ].join('\n\n'),
        schema: task === 'prepare' ? PACKAGE_SCHEMA : task === 'candidate' ? CANDIDATE_REFERENCES_SCHEMA : TIMED_TURN_SCHEMA,
        name: task === 'candidate' ? 'tara_candidate_references' : 'tara_' + task.replace('-', '_'), version: policy.version, reasoning: 'none',
        maxOutput: task === 'prepare' ? 2600 : task === 'candidate' ? 1800 : 700,
    };
}
