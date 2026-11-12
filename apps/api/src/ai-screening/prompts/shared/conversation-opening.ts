export const CONVERSATION_OPENING = 'Oke, kita mulai ya 😄';

export function openConversation(question: string) {
    const text = question.trim();
    const body = (text.startsWith(CONVERSATION_OPENING) ? text.slice(CONVERSATION_OPENING.length) : text).trim();
    if (body.length < 12 || (body.match(/\?/g) ?? []).length !== 1)
        throw new Error('INVALID_CONVERSATION_OPENING');
    if (/^(?:eh\b|nah\b|bentar\b|tadi\b|oke\b|halo\b|hai\b)/i.test(body))
        throw new Error('INVALID_CONVERSATION_OPENING');
    return CONVERSATION_OPENING + ' ' + body;
}
