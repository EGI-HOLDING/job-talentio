import type { PromptPreset } from './prompts/compose';
import { normalizeSkillKey } from '../common/skill-resolve';
import { inputTrust } from './prompts/shared/input-trust';
import { alignedCriterion, attachRoleTopics, roleInterviewCandidates, ROLE_RUBRIC_VERSION, type RoleCriterion, type RoleRubric } from './role-rubric';
import { CONVERSATION_OPENING } from './prompts/shared/conversation-opening';
import { hash, normalizedText, redactScreeningContacts } from './screening.policy';
import { validQuestion, type CandidatePayload, type JsonSchema, type PackagePayload } from './screening.schemas';
import { TIMED_CONVERSATION } from './conversation.policy';
import { taraTopics, type TaraTopic } from './tara-interview';

export const TARA_LIVE_AGENDA_VERSION = 'tara-live-agenda-v1';
const PRIOR_ALIGNED_AGENDA_VERSION = 'tara-live-agenda-v2';
export const TARA_ALIGNED_AGENDA_VERSION = 'tara-live-agenda-v3';
export const LIVE_AGENDA_PREPARATION_MS = 60_000;
export const TARA_AGENDA_CORE_TARGET = 4;
const CORE_TARGET = TARA_AGENDA_CORE_TARGET;

export type LiveAgenda = {
    version: typeof TARA_LIVE_AGENDA_VERSION | typeof PRIOR_ALIGNED_AGENDA_VERSION | typeof TARA_ALIGNED_AGENDA_VERSION;
    revision: string;
    source: 'JOB_REQUIREMENTS' | 'FROZEN_RUBRIC';
    topics: Array<{ criterionId: string; equivalentIds: string[]; question: string; why?: string; minimumEvidence?: string }>;
    deferredIds: string[];
};

const string: JsonSchema = { type: 'string' };
const ids: JsonSchema = { type: 'array', items: string };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
export function collectAlignedAgenda(value: unknown) {
    if (!value || typeof value !== 'object' || !('topics' in value) || !Array.isArray(value.topics))
        throw Error('TARA_INVALID_AGENDA_ENVELOPE');
    return {
        topics: value.topics.filter(row => row && typeof row === 'object' && !Array.isArray(row)),
        merges: 'merges' in value && Array.isArray(value.merges) ? value.merges.slice(0, 100) : [],
    };
}
export const LIVE_AGENDA_SCHEMA = object({
    topics: { type: 'array', maxItems: CORE_TARGET, items: object({ criterionId: string, equivalentIds: ids, question: string }) },
});
const agendaRef = (index: number) => 'K' + (index + 1);

export function liveAgendaRequest(rubric: RoleRubric, version?: string) {
    if (rubric.version === ROLE_RUBRIC_VERSION) return alignedAgendaRequest(rubric, version);
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

function alignedAgendaRequest(rubric: RoleRubric, version?: string) {
    const data = { position: redactScreeningContacts(rubric.title),
        ...(version !== PRIOR_ALIGNED_AGENDA_VERSION && rubric.description ? { description: redactScreeningContacts(rubric.description) } : {}),
        criteria: roleInterviewCandidates(rubric).map(row => ({ id: row.id, name: redactScreeningContacts(row.name),
            sources: row.sources?.map(({ kind, text, minimum, aliases, usageRequired, minimumUsage }) => ({ kind, text: redactScreeningContacts(text), minimum, usageRequired, minimumUsage,
                aliases: aliases?.map(redactScreeningContacts) })) })) };
    const criterionIds = data.criteria.map(row => row.id);
    // The same list occurs in three enum fields. Keep the full source data on larger rubrics.
    const ref = criterionIds.length > 0 && 3 * criterionIds.length <= 1000 &&
        criterionIds.reduce((length, id) => length + id.length, 0) <= 15_000
        ? { ...string, enum: criterionIds } : string;
    const relation = object({ representative: ref, duplicates: { type: 'array', items: ref }, sharedAction: string, sharedOutput: string });
    const preset: PromptPreset = {
        name: 'tara_aligned_role_rubric', version: TARA_ALIGNED_AGENDA_VERSION, model: 'gpt-6-luna', reasoning: 'low',
        schema: object({ merges: { type: 'array', maxItems: 100, items: relation },
            topics: { type: 'array', maxItems: Math.max(CORE_TARGET, data.criteria.length),
                items: object({ criterionId: ref, question: string, why: string, minimumEvidence: string }) } }),
        maxOutput: 4000,
        instructions: [inputTrust,
            'Bangun satu rubrik lowongan yang dipakai untuk menilai CV dan wawancara semua kandidat pada revisi ini. Gunakan hanya tugas dan skill wajib yang diberikan.',
            'Periksa seluruh criteria, lalu gabungkan parafrasa jika satu bukti cukup untuk membuktikan tindakan, hasil kerja, dan tanggung jawab yang sama. Bandingkan tujuan, hasil yang diserahkan, dan tindakan orang yang mengerjakan. Perbedaan kata yang tidak mengubah hasil kerja tetap satu tugas, seperti menyusun atau menyiapkan jadwal mingguan yang sama. Persiapan, presentasi, persetujuan, dan tindak lanjut tetap tindakan terpisah. Kesamaan alat atau proyek saja tidak cukup. Pertahankan level minimum dan syarat yang berdiri sendiri.',
            'Gunakan ID persis dari criteria untuk representative, duplicates, dan criterionId. representative adalah satu ID utama. duplicates hanya berisi ID lain yang setara. Tulis uraian tindakan dan hasil hanya di sharedAction dan sharedOutput.',
            'Setelah penggabungan, sertakan setiap keahlian wajib dan pilih tugas inti yang paling penting sampai sekitar empat topik. Jika kebutuhan wajib melebihi empat, sertakan semuanya. Pertanyaan situasional menyebut tindakan, hasil kerja atau keahlian yang diuji secara spesifik. Tiap pertanyaan meminta satu keputusan atau satu tindakan utama. Simpan alasan, hasil dan cara menguji hasil sebagai opsi pendalaman, jangan gabungkan beberapa permintaan dalam satu pertanyaan. Gunakan maksimal 30 kata dalam bahasa Indonesia gaya gua–lo. Jangan memberi jawaban. Contoh CV disiapkan terpisah. Gunakan deskripsi sebagai konteks untuk memprioritaskan tugas yang dikonfirmasi dalam criteria.',
            'Pertanyaan skenario harus bisa dijawab oleh kandidat yang belum pernah melakukan tugas itu. Gambarkan situasi yang akan dihadapi pada posisi ini. Tanyakan langkah yang akan kandidat ambil. Pertanyaan tentang pengalaman aktual dibuat terpisah.',
            'why berisi alasan singkat topik penting untuk lowongan. minimumEvidence berisi tindakan atau keputusan pribadi yang perlu terdengar, tanpa menambah persyaratan. Keduanya berdasarkan sumber kriteria dan masing-masing maksimal 20 kata.',
        ].join('\n\n'),
    };
    return { data, preset };
}

type AlignedProposal = { merges?: Array<{ representative: string; duplicates: string[]; sharedAction: string; sharedOutput: string }>;
    topics?: Array<{ criterionId: string; question: string; why?: string; minimumEvidence?: string }> };

const actionClasses: Array<{ kind: string; pattern: RegExp }> = [
    { kind: 'PREPARE', pattern: /^(?:(?:mempersiapkan|persiapkan|menyiapkan|siapkan|menyusun|susun|penyusunan|menulis|tulis|prepare|write|draft)\s)/iu },
    { kind: 'PRESENT', pattern: /^(?:(?:mempresentasikan|presentasikan|presentasi|mendemokan|demokan|menyajikan|sajikan|present|demonstrate)\s)/iu },
    { kind: 'APPROVE', pattern: /^(?:(?:memperoleh persetujuan|menyetujui|menyepakati|sepakati|persetujuan|approve|obtain approval|agree)\s)/iu },
    { kind: 'FOLLOW_UP', pattern: /^(?:(?:menindaklanjuti|tindak lanjuti|tindak lanjut|follow up)\s)/iu },
    { kind: 'COORDINATE', pattern: /^(?:(?:mengoordinasikan|koordinasi|berkoordinasi|berkolaborasi|coordinate|collaborate)\s)/iu },
    { kind: 'VERIFY', pattern: /^(?:(?:memeriksa|mengecek|periksa|memvalidasi|validasi|menguji|uji|verify|validate|test)\s)/iu },
];
const assumesExperience = /\b(?:pernah|waktu itu|pengalaman (?:lo|lu|kamu)|yang (?:lo|lu|kamu) (?:lakukan|kerjakan|alami))\b/iu;

function compatibleActions(sources: NonNullable<RoleCriterion['sources']>) {
    const kinds = new Set(sources.flatMap(source => {
        const matched = actionClasses.find(action => action.pattern.test(source.text));
        return matched ? [matched.kind] : [];
    }));
    return kinds.size <= 1;
}

export function prepareAlignedRolePackage(rubric: RoleRubric, raw: unknown, version: LiveAgenda['version'] = TARA_ALIGNED_AGENDA_VERSION): PackagePayload {
    const proposal = raw as AlignedProposal | null;
    const includesRequiredSkills = version === TARA_ALIGNED_AGENDA_VERSION;
    const candidates = roleInterviewCandidates(rubric);
    const byId = new Map(candidates.map(row => [row.id, row]));
    const imported = new Map<string, RoleCriterion>();
    const removed = new Set<string>();
    const aliasKey = (name: string) => normalizedText(name).toLowerCase().replace(/\s*[\u2010-\u2015-]\s*/gu, '-');
    const skillOwners = new Map<string, string[]>();
    for (const row of candidates) {
        const source = row.sources?.[0];
        if (source?.kind !== 'SKILL') continue;
        for (const label of new Set([source.text, ...source.aliases ?? []].map(aliasKey))) {
            const owners = skillOwners.get(label) ?? [];
            owners.push(row.id);
            skillOwners.set(label, owners);
        }
    }
    // Mutual official aliases are enough to deduplicate without a model or a keyword guess.
    for (const row of candidates) {
        const source = row.sources?.[0];
        if (source?.kind !== 'SKILL' || removed.has(row.id)) continue;
        const aliases = new Set(source.aliases?.map(aliasKey));
        const duplicates = (skillOwners.get(aliasKey(source.text)) ?? []).flatMap(id => {
            const other = byId.get(id)?.sources?.[0];
            return other?.kind === 'SKILL' && id !== row.id && !imported.has(id) && !removed.has(id) &&
                aliases.has(aliasKey(other.text)) ? [other] : [];
        });
        if (duplicates.length) {
            duplicates.forEach(other => removed.add(other.id));
            imported.set(row.id, alignedCriterion(rubric.title, [source, ...duplicates]));
        }
    }
    const remaps = new Map<string, string>();
    for (const row of imported.values()) for (const source of row.sources!.slice(1)) remaps.set(source.id, row.id);
    const active = (id: string) => imported.get(id) ?? byId.get(id);
    const used = new Set<string>();
    for (const merge of Array.isArray(proposal?.merges) ? proposal.merges : []) {
        const mainId = remaps.get(merge?.representative) ?? merge?.representative;
        const main = active(mainId);
        const sharedAction = redactScreeningContacts(normalizedText(merge?.sharedAction)).slice(0, 160);
        const sharedOutput = redactScreeningContacts(normalizedText(merge?.sharedOutput)).slice(0, 160);
        if (!main?.sources?.length || !sharedAction || !sharedOutput || removed.has(mainId) || used.has(mainId) || !Array.isArray(merge.duplicates)) continue;
        if (!merge.duplicates.every(id => typeof id === 'string')) continue;
        const otherIds = [...new Set(merge.duplicates.map(id => remaps.get(id) ?? id))].filter(id => id !== mainId);
        if (!otherIds.length || otherIds.some(id => used.has(id) || removed.has(id) || !active(id)?.sources?.length)) continue;
        // Leave distinct stages separate when the same source explicitly listed them as separate actions.
        const duplicateSources = otherIds.flatMap(id => active(id)!.sources!);
        const sources = [...main.sources, ...duplicateSources];
        // Official aliases were processed above. Independent mandatory skills must
        // survive the rubric even if they are commonly used in the same task.
        const requiredGroups = [main.sources, ...otherIds.map(id => active(id)!.sources!)]
            .filter(group => group.some(source => source.kind === 'SKILL'));
        if (includesRequiredSkills && requiredGroups.length > 1) continue;
        if (!compatibleActions(sources)) continue;
        const origins = new Set<string>();
        if (sources.some(source => {
            if (!source.original || source.kind !== 'DUTY') return false;
            if (origins.has(source.original)) return true;
            origins.add(source.original);
            return false;
        })) continue;
        used.add(mainId);
        otherIds.forEach(id => { removed.add(id); used.add(id); remaps.set(id, mainId); });
        imported.set(mainId, { ...alignedCriterion(rubric.title, sources.sort((a, b) => Number(b.kind === 'DUTY') - Number(a.kind === 'DUTY')), undefined, mainId),
            equivalence: { action: sharedAction, output: sharedOutput } });
    }
    const criteria = rubric.criteria.filter(row => !removed.has(row.id)).map(row => imported.get(row.id) ?? row);
    const selectable = new Set(roleInterviewCandidates({ ...rubric, criteria }).map(row => row.id));
    const byMergedId = new Map(criteria.map(row => [row.id, row]));
    const topics: LiveAgenda['topics'] = [];
    const selected = new Set<string>();
    const questions = new Set<string>();
    function add(criterionId: string, proposal?: NonNullable<AlignedProposal['topics']>[number]) {
        const representative = remaps.get(criterionId) ?? criterionId;
        const id = remaps.get(representative) ?? representative;
        if (!selectable.has(id) || selected.has(id)) return;
        const criterion = byMergedId.get(id)!;
        const question = redactScreeningContacts(normalizedText(proposal?.question));
        const usable = /^[^?\r\n]{12,240}\?$/u.test(question) && validQuestion(question, TIMED_CONVERSATION) && question.split(' ').length <= 30 &&
            !/\btugas berikut\b|^gimana jadinya\?|^maksudnya (?:apa|gimana)\?/iu.test(question) && !questions.has(question.toLowerCase()) &&
            (!includesRequiredSkills || !assumesExperience.test(question) || /\b(?:bakal|akan|would)\b/iu.test(question));
        const chosen = usable ? question : criterion.question;
        selected.add(id);
        questions.add(chosen.toLowerCase());
        topics.push({ criterionId: id, equivalentIds: [], question: chosen, ...(includesRequiredSkills ? {
            why: redactScreeningContacts(normalizedText(proposal?.why) || criterion.requirementRef).slice(0, 220),
            minimumEvidence: redactScreeningContacts(normalizedText(proposal?.minimumEvidence) || 'Satu tindakan pribadi atau keputusan konkret pada tugas ini.').slice(0, 220),
        } : {}) });
    }
    const proposedTopics = Array.isArray(proposal?.topics) ? proposal.topics.filter(topic =>
        topic && typeof topic.criterionId === 'string' && byId.has(topic.criterionId)) : [];
    const proposedById = new Map(proposedTopics.flatMap(topic => topic ? [[remaps.get(topic.criterionId) ?? topic.criterionId, topic] as const] : []));
    for (const row of criteria) if (row.sources?.some(item => item.kind === 'SKILL') &&
        (includesRequiredSkills || row.sources.some(item => item.kind === 'DUTY') && topics.length < CORE_TARGET))
        add(row.id, proposedById.get(row.id));
    for (const topic of proposedTopics) if (topic && topics.length < CORE_TARGET) add(topic.criterionId, topic);
    const source = proposedTopics.length ? 'JOB_REQUIREMENTS' : 'FROZEN_RUBRIC';
    const priority = (row: RoleCriterion) => row.sources?.some(item => item.kind === 'SKILL') ? 0 : 1;
    for (const row of criteria.filter(row => selectable.has(row.id)).sort((a, b) => priority(a) - priority(b))) {
        if (topics.length >= CORE_TARGET) break;
        add(row.id, proposedById.get(row.id));
    }
    const interviewIds = topics.map(topic => topic.criterionId);
    const criteriaWithQuestions = criteria.map(row => {
        const topic = topics.find(item => item.criterionId === row.id);
        return topic ? { ...row, question: topic.question } : row;
    });
    const content = { version: ROLE_RUBRIC_VERSION, title: rubric.title, sourceRevision: rubric.revision,
        ...(includesRequiredSkills ? { agendaVersion: version } : {}),
        criteria: criteriaWithQuestions, interviewIds } as const;
    const resolved = { ...content, revision: hash(content) };
    const deferredIds = [...selectable].filter(id => !selected.has(id));
    const liveAgenda: LiveAgenda = { version, revision: includesRequiredSkills ? hash([resolved.revision, topics, deferredIds]) : resolved.revision,
        source, topics, deferredIds };
    const core = new Map(criteriaWithQuestions.map(row => [row.id, row]));
    return { context: rubric.title, criteria: interviewIds.map(id => core.get(id)!), roleRubric: resolved, liveAgenda };
}

export function prepareLiveAgenda(rubric: RoleRubric, raw: unknown): LiveAgenda {
    const criteria = roleInterviewCandidates(rubric);
    const byRef = new Map(criteria.map((row, index) => [agendaRef(index), row]));
    const parsed = raw as Partial<Pick<LiveAgenda, 'topics'>> | null;
    const topics: LiveAgenda['topics'] = [];
    const selected = new Set<string>();
    const questions = new Set<string>();
    const approved = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, CORE_TARGET) : [];
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
        if (topics.length === CORE_TARGET) break;
        if (selected.has(row.id)) continue;
        selected.add(row.id);
        topics.push({ criterionId: row.id, equivalentIds: [], question: row.question });
    }
    const content = { source, topics, deferredIds: criteria.filter(row => !selected.has(row.id)).map(row => row.id) };
    return { version: TARA_LIVE_AGENDA_VERSION, revision: hash([TARA_LIVE_AGENDA_VERSION, rubric.revision, content]), ...content };
}

export function liveAgendaRubric(rubric: RoleRubric, agenda?: LiveAgenda): RoleRubric {
    if (rubric.version === ROLE_RUBRIC_VERSION) return rubric;
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
    const aligned = rubric.version === ROLE_RUBRIC_VERSION;
    const roleTopics = agenda.topics.map(topic => {
        const claim = plan.claims.find(row => row.criterionId === topic.criterionId);
        if (agenda.version === TARA_ALIGNED_AGENDA_VERSION) {
            const required = rubric.criteria.find(row => row.id === topic.criterionId)?.sources?.filter(source => source.kind === 'SKILL') ?? [];
            const main = required[0];
            const claimSkill = claim?.skill;
            const matchingSkill = claimSkill && required.some(source => [source.text, ...source.aliases ?? []]
                .some(label => normalizeSkillKey(label) === normalizeSkillKey(claimSkill))) ? claimSkill : undefined;
            const cvEvidence = (matchingSkill && claim?.scope === 'CONTEXTUAL' || required.some(source => plan.requiredSkillMentions?.[source.id] === 'CV_EXAMPLE'))
                ? 'CV_EXAMPLE' as const : matchingSkill || required.some(source => plan.requiredSkillMentions?.[source.id] === 'CV_MENTION')
                    ? 'CV_MENTION' as const : 'NOT_ATTESTED' as const;
            const requiredSkill = main && { name: main.text, cvEvidence };
            const skillName = main?.text.replace(/[?\r\n]/gu, ' ').trim();
            let namedProbe: string | undefined;
            if (skillName && (!matchingSkill || cvEvidence !== 'CV_EXAMPLE')) {
                namedProbe = cvEvidence === 'NOT_ATTESTED' ? `Lo pernah pakai ${skillName}?` :
                    `Di CV lo nyebut ${matchingSkill ?? skillName}. Bisa ceritain satu contoh lo pakai keahlian itu?`;
            }
            const claimQuestion = claim?.skill && (claim.scope === 'CONTEXTUAL' ? cvQuestion(claim.question) :
                `Di CV lo nyebut “${claim.skill}”. Bisa ceritain satu contoh waktu lo pakai keahlian itu?`);
            return { criterionId: topic.criterionId, question: namedProbe || claimQuestion || topic.question,
                cvClaimId: main && !matchingSkill ? undefined : claim?.id, requiredSkill };
        }
        return { criterionId: topic.criterionId, question: (aligned && claim && cvQuestion(claim.question ?? '')) || topic.question,
            cvClaimId: claim?.id };
    });
    if (agenda.version === TARA_ALIGNED_AGENDA_VERSION) {
        const opener = plan.claims.find(claim => roleTopics.some(row => row.cvClaimId === claim.id &&
            row.requiredSkill && row.requiredSkill.cvEvidence !== 'NOT_ATTESTED')) ??
            plan.claims.find(claim => roleTopics.some(row => row.cvClaimId === claim.id));
        const openerIndex = opener ? roleTopics.findIndex(row => row.cvClaimId === opener.id) : -1;
        if (openerIndex > 0) roleTopics.unshift(...roleTopics.splice(openerIndex, 1));
        const first = roleTopics.shift();
        roleTopics.sort((a, b) => Number(b.requiredSkill?.cvEvidence !== undefined && b.requiredSkill.cvEvidence !== 'CV_EXAMPLE') -
            Number(a.requiredSkill?.cvEvidence !== undefined && a.requiredSkill.cvEvidence !== 'CV_EXAMPLE'));
        if (first) roleTopics.unshift(first);
    } else if (aligned) roleTopics.sort((a, b) => Number(!a.cvClaimId) - Number(!b.cvClaimId));
    return { ...plan, roleTopics };
}

function cvQuestion(text: string) {
    const question = text.trim();
    return question.startsWith(CONVERSATION_OPENING) ? question.slice(CONVERSATION_OPENING.length).trim() : question;
}

export function liveInterviewTopics(plan: CandidatePayload, packet: PackagePayload, completionRubric?: RoleRubric) {
    if (packet.liveAgenda?.version === TARA_ALIGNED_AGENDA_VERSION && plan.roleTopics?.length) {
        const topics = taraTopics(plan, packet, true);
        const allowed = completionRubric ? new Set(completionRubric.interviewIds) : null;
        return allowed ? topics.filter(topic => allowed.has(topic.criterionId)) : topics;
    }
    const claims = new Map(plan.claims.map(claim => [claim.id, claim]));
    const roleClaims = new Map(plan.roleTopics?.map(topic => [topic.criterionId, topic.cvClaimId]));
    const topics = completionRubric ? completionRubric.interviewIds.flatMap<TaraTopic>(id => {
        const criterion = completionRubric.criteria.find(row => row.id === id);
        return criterion ? [{ id, criterionId: id, label: criterion.name, requirementRef: criterion.requirementRef,
            question: criterion.question, alternative: true, fields: ['TASK', 'ACTION'], priority: 'CORE' }] : [];
    }) : taraTopics(plan, packet, true);
    return topics.map<TaraTopic>(topic => {
        const claimId = roleClaims.size ? roleClaims.get(topic.criterionId) :
            completionRubric ? plan.claims.find(claim => claim.criterionId === topic.criterionId)?.id : topic.id;
        const claim = claimId === undefined ? undefined : claims.get(claimId);
        const skill = claim?.skill?.trim();
        if (completionRubric) {
            const criterion = completionRubric.criteria.find(row => row.id === topic.criterionId);
            const frozenQuestion = packet.liveAgenda?.topics.find(row => row.criterionId === topic.criterionId)?.question ??
                criterion?.question ?? topic.question;
            const scenario = /^Gimana cara lu mengerjakan tugas berikut\?/u.test(frozenQuestion) ?
                'Lo diminta mengerjakan tugas ini. Gimana langkah yang akan lo ambil untuk ' +
                    topic.label.replace(/[.?!]+$/u, '') + '?' : frozenQuestion;
            if (!claim || claim.criterionId !== topic.criterionId || !skill || !claim.quote?.trim())
                return { ...topic, question: scenario, workScenario: scenario, alternative: true, cvQuote: undefined };

            const skillKey = normalizeSkillKey(skill);
            const source = criterion?.sources?.some(row => row.kind === 'SKILL' &&
                [row.text, ...(row.aliases ?? [])].some(label => normalizeSkillKey(label) === skillKey));
            const linked = Boolean(source);
            const quotedSkill = redactScreeningContacts(skill);
            return { ...topic, alternative: !linked, cvQuote: claim.quote, skill, workScenario: scenario, needsCvBridge: !linked,
                question: linked ? 'Di CV lo nyebut ' + quotedSkill + '. Untuk tugas “' + topic.label.replace(/[.?!]+$/u, '') +
                    '”, langkah apa yang pernah lo sendiri ambil?' : scenario,
                fields: [...new Set([...(topic.fields ?? []), 'TASK', 'ACTION'] as const)] };
        }
        if (!claim || claim.criterionId !== topic.criterionId || !skill || !claim.quote?.trim())
            return { ...topic, alternative: true, cvQuote: undefined };

        const contextual = claim.scope === 'CONTEXTUAL';
        const fields = new Set(topic.fields ?? []);
        for (const evidence of claim.extraEvidence ?? []) fields.add(evidence.field);
        if (contextual) fields.add('CONTEXT');
        else fields.delete('CONTEXT');
        return { ...topic, alternative: false, cvQuote: claim.quote, skill, fields: [...fields],
            question: cvQuestion(claim.question ?? '') || `Di CV lo nyebut ${skill}. Bisa ceritain satu contoh waktu lo pakai skill itu?` };
    }).sort((a, b) => Number(a.alternative) - Number(b.alternative)).slice(0, CORE_TARGET);
}
