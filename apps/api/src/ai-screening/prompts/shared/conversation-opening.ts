import type { AssessmentLanguage } from '@job-talentio/shared';

export const CONVERSATION_OPENING = 'Oke, kita mulai ya 😄';
export const ENGLISH_CONVERSATION_OPENING = 'Hi, I’m Tara. Let’s get started.';

export function openConversation(question: string, language?: AssessmentLanguage) {
    const opening = language === 'en' ? ENGLISH_CONVERSATION_OPENING : CONVERSATION_OPENING;
    const text = question.trim();
    const body = (text.startsWith(opening) ? text.slice(opening.length) : text).trim();
    if (body.length < 12 || (body.match(/\?/g) ?? []).length !== 1)
        throw new Error('INVALID_CONVERSATION_OPENING');
    if (/^(?:eh\b|nah\b|bentar\b|tadi\b|oke\b|halo\b|hai\b)/i.test(body))
        throw new Error('INVALID_CONVERSATION_OPENING');
    return opening + ' ' + body;
}
