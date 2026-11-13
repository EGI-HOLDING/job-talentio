import type { PromptPreset } from './prompts/compose';
import { inputTrust } from './prompts/shared/input-trust';
import { attachRoleTopics, roleInterviewCandidates, type RoleRubric } from './role-rubric';
import { hash, normalizedText, redactScreeningContacts } from './screening.policy';
import type { CandidatePayload, JsonSchema, PackagePayload } from './screening.schemas';

export const TARA_LIVE_AGENDA_VERSION = 'tara-live-agenda-v1';
export const LIVE_AGENDA_PREPARATION_MS = 60_000;
const MAX_COMPETENCIES = 4;

export type LiveAgenda = {
    version: typeof TARA_LIVE_AGENDA_VERSION;
    revision: string;
    source: 'JOB_REQUIREMENTS' | 'FROZEN_RUBRIC';
    topics: Array<{ criterionId: string; equivalentIds: string[]; question: string }>;
    deferredIds: string[];
};

const string: JsonSchema = { type: 'string' };
const ids: JsonSchema = { type: 'array', items: string };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
export const LIVE_AGENDA_SCHEMA = object({
    topics: { type: 'array', maxItems: MAX_COMPETENCIES, items: object({ criterionId: string, equivalentIds: ids, question: string }) },
});
const agendaRef = (index: number) => 'K' + (index + 1);

export function liveAgendaRequest(rubric: RoleRubric) {
    const data = {
        position: redactScreeningContacts(rubric.title),
        criteria: roleInterviewCandidates(rubric).map(({ name, requirementRef }, index) => ({
            id: agendaRef(index), name: redactScreeningContacts(name), requirement: redactScreeningContacts(requirementRef),
        })),
    };
    const preset: PromptPreset = {
        name: 'tara_live_agenda', version: TARA_LIVE_AGENDA_VERSION, model: 'gpt-6-luna', reasoning: 'none',
        schema: LIVE_AGENDA_SCHEMA, maxOutput: 1600,
        instructions: [inputTrust,
            'Susun agenda wawancara kerja maksimal 15 menit. Pilih hingga empat kompetensi inti yang berbeda. Utamakan tugas inti dan skill wajib yang menentukan pekerjaan ini. Jadikan tiap topik satu kesempatan membuktikan tindakan atau keputusan pribadi yang relevan.',
            'Kelompokkan kriteria hanya jika bukti atas tindakan, hasil kerja, dan tanggung jawab yang sama cukup untuk menilai keduanya. Parafrasa tugas yang sama masuk satu topik. Tahap, keputusan, atau tanggung jawab yang berbeda tetap terpisah walaupun terkait proyek, alat, atau istilah yang sama. Pilih satu ID yang paling mewakili pekerjaan sebagai criterionId. Simpan ID lain di equivalentIds.',
            'Urutkan dari yang paling penting. Isi hingga empat topik jika tersedia. Salin ID persis dari data. Sebut setiap ID maksimal sekali. Biarkan kriteria berbeda yang tidak terpilih di luar hasil. Jangan menambah kompetensi atau syarat baru.',
            'Tulis satu pertanyaan terbuka berupa skenario pekerjaan untuk tiap topik, maksimal 30 kata. Pakai bahasa Indonesia yang jelas dan lugas. Sebut tugas atau keputusan spesifik dalam kalimat pertanyaan. Anggap kandidat belum punya pengalaman terkait. Jangan memberi jawaban, menyisipkan syarat rekaan, menyalin paragraf, atau merujuk “tugas berikut”.',
        ].join('\n\n'),
    };
    return { data, preset };
}

export function prepareLiveAgenda(rubric: RoleRubric, raw: unknown): LiveAgenda {
    const criteria = roleInterviewCandidates(rubric);
    const byRef = new Map(criteria.map((row, index) => [agendaRef(index), row]));
    const parsed = raw as Partial<Pick<LiveAgenda, 'topics'>> | null;
    const topics: LiveAgenda['topics'] = [];
    const selected = new Set<string>();
    const questions = new Set<string>();
    const approved = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, MAX_COMPETENCIES) : [];
    const representatives = new Set(approved.map(row => row?.criterionId));
    for (const row of approved) {
        const criterion = byRef.get(row?.criterionId);
        if (!criterion || selected.has(criterion.id)) continue;
        let question = redactScreeningContacts(normalizedText(row.question));
        if (!/^[^?\r\n]{12,240}\?$/u.test(question) || question.split(' ').length > 30 ||
            /\btugas berikut\b|^gimana jadinya\?|^maksudnya (?:apa|gimana)\?/iu.test(question) ||
            questions.has(question.toLocaleLowerCase('id'))) question = criterion.question;
        // Only the provider judges equivalent work. The server verifies that references are unique and grounded.
        const equivalentIds = Array.isArray(row.equivalentIds) ? [...new Set(row.equivalentIds.flatMap(ref => {
            const other = byRef.get(ref);
            return other && !representatives.has(ref) && !selected.has(other.id) ? [other.id] : [];
        }))] : [];
        selected.add(criterion.id);
        equivalentIds.forEach(id => selected.add(id));
        questions.add(question.toLocaleLowerCase('id'));
        topics.push({ criterionId: criterion.id, equivalentIds, question });
    }
    const source = topics.length ? 'JOB_REQUIREMENTS' as const : 'FROZEN_RUBRIC' as const;
    for (const row of criteria) {
        if (topics.length === MAX_COMPETENCIES) break;
        if (selected.has(row.id)) continue;
        selected.add(row.id);
        topics.push({ criterionId: row.id, equivalentIds: [], question: row.question });
    }
    const content = { source, topics, deferredIds: criteria.filter(row => !selected.has(row.id)).map(row => row.id) };
    return { version: TARA_LIVE_AGENDA_VERSION, revision: hash([TARA_LIVE_AGENDA_VERSION, rubric.revision, content]), ...content };
}

export function liveAgendaRubric(rubric: RoleRubric, agenda?: LiveAgenda): RoleRubric {
    // The CV score keeps using the original rubric revision and criteria.
    return agenda?.version === TARA_LIVE_AGENDA_VERSION && agenda.topics.length
        ? { ...rubric, interviewIds: agenda.topics.map(topic => topic.criterionId) } : rubric;
}

export function liveRolePackage(rubric: RoleRubric, liveAgenda: LiveAgenda): PackagePayload {
    const selected = new Map(rubric.criteria.map(row => [row.id, row]));
    return { context: rubric.title, liveAgenda, criteria: liveAgenda.topics.flatMap(topic => {
        const criterion = selected.get(topic.criterionId);
        return criterion ? [criterion] : [];
    }) };
}

export function attachLiveRoleTopics(plan: CandidatePayload, rubric: RoleRubric | undefined, agenda?: LiveAgenda): CandidatePayload {
    if (!rubric || !agenda?.topics.length) return attachRoleTopics(plan, rubric);
    return { ...plan, roleTopics: agenda.topics.map(topic => ({
        criterionId: topic.criterionId,
        question: topic.question,
        cvClaimId: plan.claims.find(claim => claim.criterionId === topic.criterionId)?.id,
    })) };
}
