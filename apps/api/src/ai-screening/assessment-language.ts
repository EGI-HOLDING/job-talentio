import type { AssessmentLanguage } from '@job-talentio/shared';
import { detectLocale } from '../common/i18n/detect-locale';

export function assessmentLanguageOf(snapshot: unknown): AssessmentLanguage | undefined {
    const language = (snapshot as { assessmentLanguage?: unknown } | null)?.assessmentLanguage;
    return language === 'id' || language === 'en' ? language : undefined;
}

export function assessmentTextLanguage(language: AssessmentLanguage | undefined) {
    return language === 'en' ? 'English' : 'bahasa Indonesia';
}

export function foreignPresentationText(text: string, language: AssessmentLanguage) {
    const prose = text.replace(/“[^”]*”|«[^»]*»|"[^"]*"/gu, '');
    const detected = detectLocale(prose);
    return detected !== null && detected !== language;
}

export const assessmentLanguageReminders: Record<AssessmentLanguage, string> = {
    id: 'Bisa jawab dalam bahasa Indonesia, ya?',
    en: 'Could you answer in English, please?',
};

function normalizedReminder(text: string) {
    return text.toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/\s+/gu, ' ').trim();
}

const reminderTexts = new Set(Object.values(assessmentLanguageReminders).map(normalizedReminder));
export function isAssessmentLanguageReminder(text: string, language?: AssessmentLanguage) {
    const normalized = normalizedReminder(text);
    return language ? normalized === normalizedReminder(assessmentLanguageReminders[language]) : reminderTexts.has(normalized);
}
