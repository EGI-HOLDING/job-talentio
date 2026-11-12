import { composePrompt, type PromptPreset, type ScreeningTask } from './compose';
import { screeningModel } from '../screening.policy';
import { newConversationPolicy } from '../conversation.policy';
import { freezeTakaInterview } from '../taka-interview';
export type PromptRegistry = Record<Exclude<ScreeningTask, 'evaluate'>, PromptPreset> & { takaInterview?: PromptPreset };
// Persist the assembled stable instructions/schema with each job context. A later
// deploy cannot silently change the prompts or model of an already-started session.
export function freezePromptRegistry(): PromptRegistry {
    const prompts = Object.fromEntries((['prepare', 'candidate', 'follow-up'] as const).map(task => {
        const { input: _input, ...preset } = composePrompt(task, {});
        return [task, { ...preset, model: screeningModel() }];
    })) as PromptRegistry;
    return { ...prompts, takaInterview: freezeTakaInterview() };
}

export function currentTaraPrompt(snapshot: unknown, task: Exclude<ScreeningTask, 'evaluate'>) {
    const prompt = (snapshot as PromptRegistry | null)?.[task];
    if (prompt?.version !== newConversationPolicy().version) throw new Error('RETIRED_TARA_PROMPT');
    return prompt;
}
