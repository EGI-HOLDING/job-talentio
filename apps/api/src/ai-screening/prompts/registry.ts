import { composePrompt, type PromptPreset, type ScreeningTask } from './compose';
import { screeningModel } from '../screening.policy';
import { CURRENT_CONVERSATION, type ConversationPolicy } from '../conversation.policy';
export type PromptRegistry = Record<Exclude<ScreeningTask, 'cv-score'>, PromptPreset>;
// Persist the assembled stable instructions/schema with each job context. A later
// deploy cannot silently change the prompts or model of an already-started session.
export function freezePromptRegistry(policy: ConversationPolicy = CURRENT_CONVERSATION): PromptRegistry {
    return Object.fromEntries((['prepare', 'candidate', 'follow-up', 'evaluate'] as const).map(task => {
        const { input: _input, ...preset } = composePrompt(task, {}, undefined, policy);
        return [task, { ...preset, model: screeningModel() }];
    })) as PromptRegistry;
}
