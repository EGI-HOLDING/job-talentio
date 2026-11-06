export type ConversationPolicy = Readonly<{
    version: string;
    questionSeconds: number;
    maxCore: number;
    maxFollowUp: number;
    maxPerRoot: number;
    probeOrder: 'per-claim' | 'breadth-first';
    maxWords: number;
    maxCharacters: number;
}>;

export const CONVERSATION_VERSION = 'tara-conversation-v5.0.0';
export const CURRENT_CONVERSATION: ConversationPolicy = Object.freeze({
    version: CONVERSATION_VERSION, questionSeconds: 60, maxCore: 3, maxFollowUp: 5,
    maxPerRoot: 2, probeOrder: 'breadth-first', maxWords: 35, maxCharacters: 280,
});
export const V4_CONVERSATION: ConversationPolicy = Object.freeze({
    version: 'tara-conversation-v4.0.1', questionSeconds: 30, maxCore: 3, maxFollowUp: 5,
    maxPerRoot: 2, probeOrder: 'breadth-first', maxWords: 35, maxCharacters: 280,
});
export const LEGACY_CONVERSATION: ConversationPolicy = Object.freeze({
    version: 'tara-conversation-v3', questionSeconds: 60, maxCore: 5, maxFollowUp: 10,
    maxPerRoot: 2, probeOrder: 'per-claim', maxWords: 45, maxCharacters: 360,
});

// Missing snapshots are pre-v4 packages. Never upgrade an active session implicitly.
export function conversationPolicy(snapshot: unknown): ConversationPolicy {
    if (snapshot == null) return LEGACY_CONVERSATION;
    const value = snapshot as Record<string, unknown>;
    // Patch releases can change the frozen voice prompt while retaining this policy.
    // An existing v4 snapshot must stay readable after a later v4 prompt release.
    const known = typeof value.version === 'string' && /^tara-conversation-v5\.\d+\.\d+$/.test(value.version)
        ? Object.freeze({ ...CURRENT_CONVERSATION, version: value.version })
        : typeof value.version === 'string' && /^tara-conversation-v4\.\d+\.\d+$/.test(value.version)
        ? Object.freeze({ ...V4_CONVERSATION, version: value.version })
        : value.version === LEGACY_CONVERSATION.version ? LEGACY_CONVERSATION : undefined;
    if (!known || Object.entries(known).some(([key, expected]) => value[key] !== expected))
        throw new Error('INVALID_CONVERSATION_POLICY');
    return known;
}

export const CURRENT_ASSESSMENT_VERSION = 'tara-cv-claims-v3.0.3';
export function isClaimAssessmentVersion(version: string) { return /^tara-cv-claims-v3\.\d+\.\d+$/.test(version); }
export function assessmentVersion(policy: ConversationPolicy) { return policy.probeOrder === 'breadth-first' ? CURRENT_ASSESSMENT_VERSION : 'tara-cv-claims-v3.0.0'; }

export function conversationTone(answers: Array<{ answer: string | null }>) {
    return answers.some(q => /(?:kurang|tidak|nggak|gak) nyaman.{0,25}(?:bercanda|candaan)|(?:jangan|tanpa|tidak usah|nggak usah) (?:bercanda|candaan)|(?:tolong|mohon) (?:lebih serius|langsung|formal)/i.test(q.answer ?? '')) ? 'direct' as const : 'playful' as const;
}

// A repeated question with only chat filler changed offers no new opportunity.
// Use equality after normalization, not fuzzy similarity that can merge distinct probes.
export function repeatsQuestion(question: string, previous: string[]) {
    const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('id').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/u)
        .filter(word => word && !['pas', 'lu', 'gue', 'kamu', 'aku', 'itu', 'biasanya', 'tadi', 'ya', 'nih', 'dong', 'wkwk', 'eh', 'terus', 'mulai'].includes(word)).join(' ');
    const next = normalize(question);
    return next.length >= 12 && previous.some(text => normalize(text) === next);
}

export function publicConversationPolicy(policy: ConversationPolicy) {
    return { version: policy.version, questionSeconds: policy.questionSeconds, maxQuestions: policy.maxCore + policy.maxFollowUp };
}
