import { composePrompt, type PromptPreset, type ScreeningTask } from './compose';
import { screeningModel } from '../screening.policy';
import { newConversationPolicy } from '../conversation.policy';
import { freezeTakaInterview } from '../taka-interview';
type ConversationTask = Exclude<ScreeningTask, 'evaluate' | 'live-agenda'>;
export type PromptRegistry = Record<ConversationTask, PromptPreset> & { takaInterview?: PromptPreset; liveAgenda?: PromptPreset };
// Persist the assembled stable instructions/schema with each job context. A later
// deploy cannot silently change the prompts or model of an already-started session.
export function freezePromptRegistry(): PromptRegistry {
    const prompts = Object.fromEntries((['prepare', 'candidate', 'follow-up'] as const).map(task => {
        const { input: _input, ...preset } = composePrompt(task, {});
        return [task, { ...preset, model: screeningModel() }];
    })) as PromptRegistry;
    return { ...prompts, takaInterview: freezeTakaInterview() };
}

export function currentTaraPrompt(snapshot: unknown, task: ConversationTask) {
    const prompt = (snapshot as PromptRegistry | null)?.[task];
    if (prompt?.version !== newConversationPolicy().version) throw new Error('RETIRED_TARA_PROMPT');
    return prompt;
}
