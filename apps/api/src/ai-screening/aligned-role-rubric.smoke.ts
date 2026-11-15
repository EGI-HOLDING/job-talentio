import assert from 'node:assert/strict';
import { buildCandidatePreparation, candidateEvidence } from './candidate-preparation';
import { createVoiceRequest } from './prompts/voice-session';
import { alignedRoleFromPacket, createRoleRubric, ROLE_RUBRIC_VERSION } from './role-rubric';
import { fileChecksum } from './recruitment/cv-scoring.policy';
import { projectCvScore, reuseCvResult } from './recruitment/cv-assessment';
import { attachLiveRoleTopics, liveAgendaRequest, liveInterviewTopics, prepareAlignedRolePackage } from './tara-live-agenda';
import { advanceTara, startTara, taraTopics } from './tara-interview';

function liveBrief(topics: ReturnType<typeof taraTopics>) {
    const { session } = createVoiceRequest('marin', 'sdp', topics, 'Rani', {});
    const brief = JSON.parse(session.input[0].content[0].text.split('\n')[1]);
    return brief.topics as Array<{ criterionId: string; context: string; question: string; workScenario?: string }>;
}

const duties = ['Menggali kebutuhan calon klien', 'Berkolaborasi dengan Studio untuk mengatur produksi',
    'Menyiapkan proposal dan materi presentasi', 'Mempresentasikan solusi, menjawab pertanyaan, dan menindaklanjuti masukan',
    'Memeriksa kelayakan rancangan teknis', 'Memperoleh persetujuan atas ruang lingkup pekerjaan'];
const roleSkills = [{ skillId: 'skill-proposal', skill: { name: 'Penyusunan proposal', aliases: [{ alias: 'Proposal solusi' }] }, isRequired: true },
    { skillId: 'skill-pitch', skill: { name: 'Presentasi solusi' }, isRequired: true }];
const job = { title: 'Presales Engineer', responsibilities: duties, jobSkills: roleSkills, jobLanguages: [] };
const sourceRubric = createRoleRubric(job, ROLE_RUBRIC_VERSION);
const find = (text: string) => sourceRubric.criteria.find(row => row.name === text)!.id;
const [discovery, studio, proposal, slides, pitch, followUp, technical, approval] = [find(duties[0]), find(duties[1]),
    find('Menyiapkan proposal'), find('Menyiapkan materi presentasi'), find('Mempresentasikan solusi'), find('menindaklanjuti masukan'), find(duties[4]), find(duties[5])];
const brief = liveAgendaRequest(sourceRubric);
assert.equal(brief.data.criteria.length, 11, 'every confirmed action and distinct deliverable participates before selecting four');
const ids = brief.data.criteria.map(row => row.id);
const mergedFields = brief.preset.schema.properties?.merges.items?.properties;
assert.deepEqual(mergedFields?.representative.enum, ids, 'a representative must be one source ID');
assert.deepEqual(mergedFields?.duplicates.items?.enum, ids, 'duplicates use the same source IDs');
assert.deepEqual(brief.preset.schema.properties?.topics.items?.properties?.criterionId.enum, ids);
const merge = (representative: string, duplicate: string, sharedAction: string, sharedOutput: string) => ({ representative,
    duplicates: [duplicate], sharedAction, sharedOutput });
const planned = { merges: [merge(proposal, 'skill-proposal', 'menyusun', 'proposal'), merge(pitch, 'skill-pitch', 'mempresentasikan', 'solusi'),
    merge(studio, proposal, 'menyusun', 'proposal'), merge(technical, approval, 'memeriksa', 'rancangan'),
    merge(slides, pitch, 'menyiapkan', 'materi presentasi'),
    merge(pitch, followUp, 'presentasi', 'masukan')], topics: [
    { criterionId: discovery, question: 'Gimana lu menggali kebutuhan calon klien di pertemuan pertama?' },
    { criterionId: 'skill-proposal', question: 'Apa yang bakal lu lakukan untuk menyusun proposal berdasarkan kebutuhan klien?' },
    { criterionId: studio, question: 'Gimana lu membagi tanggung jawab produksi dengan tim Studio?' },
    { criterionId: pitch, question: 'Gimana lu menyampaikan solusi yang kompleks ke klien?' },
 ] };
const packet = prepareAlignedRolePackage(sourceRubric, planned);
const rubric = packet.roleRubric!;
assert.equal(alignedRoleFromPacket({ roleRubric: sourceRubric }, packet)?.revision, rubric.revision);
assert.equal(rubric.criteria.length, 9);
assert.deepEqual(rubric.interviewIds, [proposal, pitch, discovery, studio]);
assert.deepEqual(rubric.criteria.find(row => row.id === proposal)?.sources?.map(row => row.id), [proposal, 'skill-proposal']);
assert.deepEqual(rubric.criteria.find(row => row.id === proposal)?.equivalence, { action: 'menyusun', output: 'proposal' });
assert.ok(rubric.criteria.some(row => row.id === followUp));
assert.ok(rubric.criteria.some(row => row.id === slides));
assert.ok(rubric.criteria.some(row => row.id === technical) && rubric.criteria.some(row => row.id === approval));
const duplicate = createRoleRubric({ ...job, responsibilities: [...duties, duties[2]] }, ROLE_RUBRIC_VERSION);
assert.equal(duplicate.revision, sourceRubric.revision);
assert.equal(prepareAlignedRolePackage(duplicate, planned).roleRubric?.revision, rubric.revision);
assert.notEqual(alignedRoleFromPacket({ roleRubric: createRoleRubric({ ...job, responsibilities: [...duties, 'Mencatat keputusan klien'] }, ROLE_RUBRIC_VERSION) }, packet)?.revision, rubric.revision);

const cv = candidateEvidence('Rani Contoh\nMenyusun proposal solusi yang menjelaskan opsi dan biaya.\nKeahlian Presentasi solusi.', 'Rani Contoh');
const proposed = { claims: [
    { sourceRef: cv[0].id, skillText: 'proposal solusi', criterionId: studio, relevance: 'CORE' },
    { sourceRef: cv[0].id, skillText: 'proposal solusi', criterionId: proposal, relevance: 'CORE' },
    { sourceRef: cv[1].id, skillText: 'Presentasi solusi', criterionId: pitch, relevance: 'CORE' },
 ] };
const candidateRubric = { ...packet, criteria: rubric.criteria };
const prepare = (answer: unknown) => buildCandidatePreparation(cv, candidateRubric, job, [answer], { coreIds: rubric.interviewIds });
const plan = prepare(proposed);
assert.equal(plan.rejected, 1, 'a recognized proposal alias cannot be attached to Studio coordination');
assert.deepEqual(plan.payload.claims.map(row => row.criterionId), [proposal, pitch]);
const attached = attachLiveRoleTopics(plan.payload, rubric, packet.liveAgenda);
const topics = liveInterviewTopics(attached, packet);
assert.deepEqual(topics.map(row => row.criterionId), [proposal, pitch, discovery, studio]);
assert.equal(topics.find(row => row.id === studio)?.alternative, true);
assert.match(topics.find(row => row.id === studio)!.question, /Studio/);
assert.equal(prepare({ claims: [proposed.claims[0]] }).payload.claims[0].criterionId, proposal);
const pitchOnly = buildCandidatePreparation([cv[1]], candidateRubric, job, [{ claims: [proposed.claims[2]] }],
    { coreIds: rubric.interviewIds }).payload;
const chat = taraTopics(attachLiveRoleTopics(pitchOnly, rubric, packet.liveAgenda), packet, true);
assert.equal(chat[0].criterionId, pitch);
assert.match(chat[0].question, /CV.*Presentasi solusi/u);
assert.deepEqual(chat.map(row => row.criterionId).sort(), [...rubric.interviewIds].sort());
const discoveryCv = candidateEvidence('Keahlian discovery workshop.', '');
const discoveryPlan = buildCandidatePreparation(discoveryCv, candidateRubric, job, [{ claims: [
    { sourceRef: discoveryCv[0].id, skillText: 'discovery workshop', criterionId: discovery, relevance: 'CORE' },
] }], { coreIds: rubric.interviewIds }).payload;
const discoveryTopics = liveInterviewTopics(attachLiveRoleTopics(discoveryPlan, rubric, packet.liveAgenda), packet);
assert.equal(discoveryTopics[0].criterionId, discovery);
assert.match(discoveryTopics[0].question, /CV lo nyebut “discovery workshop”.*satu contoh waktu lo pakai/u,
    'a skill listed without a project context gets a question about actual use');
assert.doesNotMatch(discoveryTopics[0].question, /di proyek|pakai di perusahaan/iu);
const knownOutsideCore = { ...proposed.claims[0], criterionId: studio };
const outside = buildCandidatePreparation(cv, candidateRubric, job, [{ claims: [knownOutsideCore] }], { coreIds: [studio] });
assert.equal(outside.payload.claims.length, 0);
const graphicCv = candidateEvidence('Menyiapkan poster final untuk cetak dengan Adobe Photoshop.', '');
const graphicJob = { title: 'Graphic Designer', responsibilities: ['Menyiapkan materi poster untuk cetak'],
    jobSkills: [{ skillId: 'photoshop', skill: { name: 'Adobe Photoshop' }, isRequired: true }], jobLanguages: [] };
const graphicPacket = prepareAlignedRolePackage(createRoleRubric(graphicJob, ROLE_RUBRIC_VERSION), undefined);
const graphicRubric = graphicPacket.roleRubric!;
const graphicPlan = buildCandidatePreparation(graphicCv, graphicPacket, graphicJob, [{ claims: [{ sourceRef: graphicCv[0].id,
    skillText: graphicCv[0].text, criterionId: graphicRubric.criteria[0].id, relevance: 'CORE' }] }], { coreIds: graphicRubric.interviewIds });
assert.equal(graphicPlan.rejected, 1);
assert.equal(graphicPlan.payload.claims[0].skill, 'Adobe Photoshop');
assert.equal(graphicPlan.payload.claims[0].scope, 'CONTEXTUAL');
assert.deepEqual(liveInterviewTopics(attachLiveRoleTopics(graphicPlan.payload, graphicRubric, graphicPacket.liveAgenda), graphicPacket)
    .slice(0, 1).map(topic => topic.skill), ['Adobe Photoshop']);
const graphicTopics = liveInterviewTopics(attachLiveRoleTopics(graphicPlan.payload, graphicRubric, graphicPacket.liveAgenda), graphicPacket);
assert.ok(graphicTopics[0].fields?.includes('CONTEXT'), 'the explicit CV assignment reaches Chat and the Live brief');
const graphicDutyClaim = { ...graphicPlan.payload.claims[0], id: 'graphic-duty', criterionId: graphicRubric.criteria[0].id,
    skill: 'persiapan poster', scope: 'GENERAL' as const };
const graphicCompeting = { ...graphicPlan.payload, claims: [graphicDutyClaim, ...graphicPlan.payload.claims] };
assert.equal(liveInterviewTopics(attachLiveRoleTopics(graphicCompeting, graphicRubric, graphicPacket.liveAgenda), graphicPacket)
    [0].requiredSkill?.name, 'Adobe Photoshop', 'a required skill supported by the CV wins the opening over a general example');
const invitation = createVoiceRequest('marin', 'sdp', topics, 'Rani Contoh');
assert.equal(invitation.session.model, 'gpt-live-1');
assert.deepEqual(invitation.session.delegation, { type: 'client' });
assert.match(invitation.session.input[1].content[0].text, /gua Tara.*Bisa kita mulai\?/);
assert.deepEqual(liveInterviewTopics(attachLiveRoleTopics({ claims: [], limitations: [] }, rubric, packet.liveAgenda), packet)
    .map(row => row.criterionId), rubric.interviewIds, 'core coverage is the same on another CV');

const fallback = prepareAlignedRolePackage(sourceRubric, { merges: [], topics: [] });
assert.equal(fallback.liveAgenda?.source, 'FROZEN_RUBRIC');
assert.equal(fallback.criteria.length, 4);
assert.equal(fallback.roleRubric?.criteria.length, sourceRubric.criteria.length, 'unproven equivalences retain all confirmed requirements');

const cvSource = { readable: true, fullName: 'Rani Contoh', email: null, phone: null, headline: 'Presales', summary: 'Bukti tertulis.',
    limitations: [], pages: [{ page: 1, status: 'READ' as const }], blocks: [{ id: 'p1-b1', page: 1, text: cv[0].text }] };
const grades = rubric.criteria.map(row => ({ criterionId: row.id, level: row.id === proposal ? 4 : 0,
    reason: row.id === proposal ? 'Proposal didukung CV.' : 'Bukti belum tercantum.', blockIds: row.id === proposal ? ['p1-b1'] : [] }));
const scored = projectCvScore(cvSource, grades, true, false, rubric);
assert.equal(scored.score, 11.1, 'equal weight after folding the proposal duty and skill');
const checksum = fileChecksum(Buffer.from('fixture-cv'));
const saved = { ...scored.result, roleAssessment: { rubricRevision: rubric.revision },
    sourceReferences: { ...scored.sourceReferences, checksum, model: 'gpt-6-luna', extractionVersion: 'taka-cv-source-v1', fileKind: 'PDF' } };
const refreshed = reuseCvResult(saved, checksum, 'gpt-6-luna', 'taka-cv-source-v1', fallback.roleRubric);
assert.equal(refreshed?.stage, 'GRADE');
assert.equal(refreshed?.grades.length, 0);
assert.deepEqual(refreshed?.source?.blocks, cvSource.blocks);

const otherRole = createRoleRubric({ title: 'Production Planner', responsibilities: ['Prepare production schedules',
    'Approve supply plans and document inventory decisions', 'Review material constraints'], jobSkills: [], jobLanguages: [] }, ROLE_RUBRIC_VERSION);
assert.equal(otherRole.criteria.length, 4);
assert.ok(otherRole.criteria.some(row => row.name === 'document inventory decisions'));

const oldListing = { title: 'Warehouse Coordinator', responsibilities: [], jobSkills: [], jobLanguages: [],
    description: '<p>Ringkasan posisi gudang.</p><h3>Tanggung jawab utama:</h3><ul><li>Menyiapkan pengiriman harian.</li>' +
        '<li>Memeriksa jumlah barang.</li></ul><h3>Persyaratan:</h3><p>Menguasai aplikasi persediaan.</p>' +
        '<h3>Benefit:</h3><p>Mendapat tunjangan transportasi.</p>' };
const descriptionRubric = createRoleRubric(oldListing, ROLE_RUBRIC_VERSION);
assert.deepEqual(descriptionRubric.criteria.map(row => row.name), ['Menyiapkan pengiriman harian', 'Memeriksa jumlah barang']);
assert.equal(prepareAlignedRolePackage(descriptionRubric, null).liveAgenda?.topics.length, 2);
assert.deepEqual(createRoleRubric({ ...oldListing, responsibilities: ['Mencatat selisih barang'] }, ROLE_RUBRIC_VERSION)
    .criteria.map(row => row.name), ['Mencatat selisih barang'], 'structured duties take precedence');
assert.deepEqual(createRoleRubric({ ...oldListing, description: 'Kami perusahaan logistik. Tidak bertugas mengemudikan truk.' }, ROLE_RUBRIC_VERSION)
    .interviewIds, [], 'a company introduction and negated duty yield no criterion');
assert.deepEqual(createRoleRubric({ ...oldListing, description: 'Kandidat akan mengatur pengiriman harian. Persyaratan: memiliki sertifikat.' },
    ROLE_RUBRIC_VERSION).criteria.map(row => row.name), ['Kandidat akan mengatur pengiriman harian']);

const descriptionSkillsJob = { title: 'Localization Engineer', responsibilities: ['Mempersiapkan materi lokalisasi'],
    description: 'Persyaratan wajib: Berpengalaman menggunakan Trados Studio.\n' +
        'Kandidat harus menguasai SQLite.\nKeahlian wajib: C++; C#\n' +
        'Kandidat tidak wajib memakai Figma. Pengalaman menggunakan Photoshop menjadi nilai tambah.\n' +
        'Persyaratan: Menguasai Google Sheets atau Microsoft Excel.\n' +
        'Nice-to-have: Kandidat wajib menguasai Subversion.',
    jobSkills: [{ skillId: 'trados', skill: { name: 'SDL Trados Studio', aliases: [{ alias: 'Trados Studio' }] }, isRequired: true }],
    jobLanguages: [] };
const descriptionSkillPacket = prepareAlignedRolePackage(createRoleRubric(descriptionSkillsJob, ROLE_RUBRIC_VERSION), null);
const descriptionSkillRubric = descriptionSkillPacket.roleRubric!;
assert.deepEqual(descriptionSkillRubric.criteria.flatMap(row => row.sources?.filter(source => source.kind === 'SKILL').map(source => source.text) ?? [])
    .sort(), ['C#', 'C++', 'SDL Trados Studio', 'SQLite'].sort(), 'only explicit mandatory skills are added, and structured aliases are counted once');
const descriptionCv = candidateEvidence('Mengelola glosarium dengan SQLite.\nKeahlian: C++.', '');
const descriptionSkillPlan = buildCandidatePreparation(descriptionCv, descriptionSkillPacket, descriptionSkillsJob, [],
    { coreIds: descriptionSkillRubric.interviewIds });
const descriptionSkillTopics = liveInterviewTopics(attachLiveRoleTopics(descriptionSkillPlan.payload, descriptionSkillRubric,
    descriptionSkillPacket.liveAgenda), descriptionSkillPacket, descriptionSkillRubric);
assert.equal(descriptionSkillTopics[0].requiredSkill?.name, 'SQLite');
assert.equal(descriptionSkillTopics[0].requiredSkill?.cvEvidence, 'CV_EXAMPLE');
assert.equal(descriptionSkillTopics[0].cvQuote, 'Mengelola glosarium dengan SQLite.');
assert.equal(descriptionSkillTopics.find(row => row.requiredSkill?.name === 'C++')?.requiredSkill?.cvEvidence, 'CV_MENTION');
assert.equal(descriptionSkillTopics.find(row => row.requiredSkill?.name === 'C#')?.question, 'Lo pernah pakai C#?');
assert.equal(descriptionSkillRubric.criteria.find(row => row.id === 'trados')?.requirementRef, 'Pengalaman menggunakan SDL Trados Studio');
assert.ok(descriptionSkillRubric.criteria.some(row => row.sources?.some(source => source.kind === 'SKILL' && source.text === 'SQLite' &&
    source.original === 'Kandidat harus menguasai SQLite.')));
const aliasCv = candidateEvidence('Keahlian: Trados Studio.', '');
const aliasPlan = buildCandidatePreparation(aliasCv, descriptionSkillPacket, descriptionSkillsJob, [], { coreIds: descriptionSkillRubric.interviewIds });
const aliasTopics = taraTopics(attachLiveRoleTopics(aliasPlan.payload, descriptionSkillRubric, descriptionSkillPacket.liveAgenda),
    descriptionSkillPacket, true);
const trados = aliasTopics.find(topic => topic.requiredSkill?.name === 'SDL Trados Studio');
assert.equal(trados?.requiredSkill?.cvEvidence, 'CV_MENTION');
assert.match(trados?.question ?? '', /^Di CV lo nyebut Trados Studio\./u, 'a grounded opener quotes the skill name used by the candidate');
const descriptionEnglish = createRoleRubric({ title: 'Production Editor', responsibilities: [], jobSkills: [], jobLanguages: [],
    description: '<h2>Requirements</h2><p>Experience with InDesign, Adobe Acrobat and XLIFF.</p><p>Translation QA is required.</p>' +
        '<p>Must be proficient in Affinity Publisher.</p><p>Photoshop is not required.</p>' }, ROLE_RUBRIC_VERSION);
assert.deepEqual(descriptionEnglish.criteria.map(row => row.name).sort(), ['Adobe Acrobat', 'Affinity Publisher', 'InDesign', 'Translation QA', 'XLIFF']);
const typicalRequirements = createRoleRubric({ title: 'Localization Engineer', responsibilities: ['Menyiapkan materi lokalisasi'],
    description: 'Requirements:\n• Hands-on experience with SDL Trados Studio and memoQ.\n' +
        '• Experience with XLIFF 2.0 and XML QA.\n• At least 2 years of experience using Phrase TMS.\n' +
        'Kualifikasi:\n• Minimal 2 tahun pengalaman menggunakan Adobe InDesign dan Adobe Acrobat.\n' +
        '• Memiliki pengalaman menggunakan Figma menjadi nilai tambah.\n' +
        '• Experience with Google Sheets or Microsoft Excel.', jobSkills: [], jobLanguages: [] }, ROLE_RUBRIC_VERSION);
const typicalSkills = typicalRequirements.criteria.flatMap(row => row.sources?.filter(source => source.kind === 'SKILL') ?? []);
assert.deepEqual(typicalSkills.map(row => row.text).sort(),
    ['Adobe Acrobat', 'Adobe InDesign', 'Phrase TMS', 'SDL Trados Studio', 'XLIFF 2.0', 'XML QA', 'memoQ'].sort());
assert.ok(typicalSkills.every(row => row.usageRequired));
assert.deepEqual(typicalSkills.filter(row => row.minimumUsage).map(row => [row.text, row.minimumUsage]).sort(),
    [['Adobe Acrobat', '2 tahun'], ['Adobe InDesign', '2 tahun'], ['Phrase TMS', '2 years']]);
assert.equal(typicalRequirements.criteria.find(row => row.name === 'Phrase TMS')?.requirementRef,
    'Pengalaman menggunakan Phrase TMS (min. 2 years)');
assert.equal(prepareAlignedRolePackage(typicalRequirements, null).liveAgenda?.topics.length, typicalSkills.length,
    'multiple named experience requirements stay distinct and are not silently dropped when they exceed four');
const legacySkill = createRoleRubric({ title: 'Editor', description: 'Persyaratan: Pengalaman menggunakan FrameMaker.',
    jobSkills: [{ skillId: 'framemaker', skill: { name: 'Adobe FrameMaker', aliases: [{ alias: 'FrameMaker' }] },
        isRequired: false }, { skillId: 'figma', skill: { name: 'Figma' }, isRequired: false }], jobLanguages: [] }, ROLE_RUBRIC_VERSION);
assert.deepEqual(legacySkill.criteria.map(row => [row.id, row.name, row.sources?.[0].usageRequired]),
    [['framemaker', 'Adobe FrameMaker', true]], 'an explicit requirement in the posting survives an older optional skill tag');
assert.deepEqual(createRoleRubric({ title: 'Editor', description: 'Persyaratan: Menguasai Search and Replace.\n' +
    'Wajib menguasai Research and Development.', jobSkills: [{ skillId: 'research', skill: { name: 'Research and Development' },
        isRequired: true }], jobLanguages: [] }, ROLE_RUBRIC_VERSION).criteria.map(row => row.name).sort(),
    ['Research and Development', 'Search and Replace'], 'keep a named capability when a conjunction is part of its name');

const kitchenJob = { title: 'Line Cook', responsibilities: ['Menyiapkan bahan makan malam'], jobSkills: [], jobLanguages: [] };
const kitchenPacket = prepareAlignedRolePackage(createRoleRubric(kitchenJob, ROLE_RUBRIC_VERSION), null);
const kitchenCv = candidateEvidence('Menyiapkan bahan makan malam dengan Knife Skills.', '');
const kitchenPlan = buildCandidatePreparation(kitchenCv, kitchenPacket, kitchenJob, [{ claims: [
    { sourceRef: kitchenCv[0].id, criterionId: kitchenPacket.criteria[0].id, skillText: 'Menyiapkan bahan makan malam', relevance: 'CORE' },
    { sourceRef: kitchenCv[0].id, criterionId: kitchenPacket.criteria[0].id, skillText: 'Knife Skills', relevance: 'CORE' },
] }], { coreIds: kitchenPacket.roleRubric!.interviewIds });
assert.deepEqual(kitchenPlan.payload.claims.map(claim => claim.skill), ['Knife Skills'], 'a CV experience phrase is not a skill name');

for (const fixture of [
    { title: 'AI Engineer', gap: 'LangChain', skill: 'Python', tasks: ['Menyiapkan data model', 'Menerapkan model ke produksi'],
        tools: ['PyTorch', 'FastAPI', 'Docker'], listed: 'Docker', cv: 'Membangun layanan inferensi dengan Python.\nKeahlian Docker.' },
    { title: 'Warehouse Coordinator', gap: 'SAP EWM', skill: 'Excel', tasks: ['Mencatat perpindahan stok', 'Memeriksa kiriman keluar'],
        tools: ['Barcode Scanner', 'Forklift', 'Cycle Counting'], listed: 'Barcode Scanner', cv: 'Mengelola persediaan dengan Excel.\nKeahlian Barcode Scanner.' },
    { title: 'Graphic Designer', gap: 'Adobe InDesign', skill: 'Adobe Photoshop', tasks: ['Menyusun panduan merek', 'Menyiapkan materi cetak'],
        tools: ['Figma', 'Adobe Illustrator', 'Typography'], listed: 'Figma', cv: 'Merancang materi promosi dengan Adobe Photoshop.\nKeahlian Figma.' },
]) {
    const targetJob = { title: fixture.title, responsibilities: fixture.tasks, jobLanguages: [],
        jobSkills: [fixture.gap, fixture.skill, ...fixture.tools].map(name => ({ skillId: name, isRequired: true, skill: { name } })) };
    const raw = createRoleRubric(targetJob, ROLE_RUBRIC_VERSION);
    // The provider mixed up two tools and did not include the mandatory gap in its proposal.
    const resolved = prepareAlignedRolePackage(raw, {
        topics: [{ criterionId: fixture.gap, question: `Apa tindakan yang lo lakukan dengan ${fixture.gap} waktu itu?` }],
        merges: [merge(fixture.skill, fixture.gap, 'menggunakan', 'satu hasil kerja')],
    });
    const shared = resolved.roleRubric!;
    const sources = candidateEvidence(fixture.cv, '');
    assert.equal(shared.interviewIds.length, 5);
    const grounded = buildCandidatePreparation(sources, resolved, targetJob, [], { coreIds: shared.interviewIds });
    const selection = attachLiveRoleTopics(grounded.payload, shared, resolved.liveAgenda);
    const chatTopics = taraTopics(selection, resolved, true);
    const liveTopics = liveInterviewTopics(selection, resolved, shared);
    assert.deepEqual(liveTopics, chatTopics);
    assert.equal(liveTopics[0].requiredSkill?.name, fixture.skill, 'the opener uses a skill with actual CV context');
    const gap = liveTopics.find(topic => topic.requiredSkill?.name === fixture.gap)!;
    assert.equal(gap.requiredSkill?.cvEvidence, 'NOT_ATTESTED');
    assert.ok(gap.question.includes(fixture.gap) && gap.workScenario?.includes(fixture.gap));
    assert.doesNotMatch(gap.workScenario!, /waktu itu/u, 'a scenario cannot assume the missing skill was used');
    const liveGap = liveBrief(liveTopics).find(topic => topic.criterionId === gap.criterionId)!;
    assert.equal(liveGap.context, 'REQUIRED_SKILL_EXPERIENCE', 'an explicit experience question must not be presented as a work scenario');
    assert.equal(liveGap.question, `Lo pernah pakai ${fixture.gap}?`);
    assert.notEqual(liveGap.workScenario, liveGap.question);
    assert.equal(liveTopics.find(topic => topic.requiredSkill?.name === fixture.listed)?.requiredSkill?.cvEvidence, 'CV_MENTION');
    assert.equal(liveTopics[0].requiredSkill?.cvEvidence, 'CV_EXAMPLE');
    assert.equal(new Set(liveTopics.map(topic => topic.criterionId)).size, fixture.tools.length + 2);

    const progress = startTara([gap], true);
    const missingExperience = 'Jujur, gue belum pernah pakai ' + fixture.gap + '.';
    const clarification = advanceTara(progress, [gap], { questionRef: 'chat-gap', answerRefs: ['chat-gap'],
        answered: true, previous: [gap.question], answers: [{ ref: 'chat-gap', text: missingExperience }],
        decision: { outcome: 'NEEDS_DETAIL', answerQuote: missingExperience, question: 'Apa tindakan pribadi lo waktu pakai keahlian itu?' } });
    assert.equal(clarification.question, gap.workScenario, 'Chat asks the prepared scenario after an explicit lack of experience');
    const afterQualification = missingExperience.slice(0, -1) + ' di kantor tapi gue pernah pakai di proyek sendiri.';
    const positive = advanceTara(progress, [gap], { questionRef: 'chat-gap', answerRefs: ['chat-gap'],
        answered: true, previous: [gap.question], answers: [{ ref: 'chat-gap', text: afterQualification }],
        decision: { outcome: 'NEEDS_DETAIL', answerQuote: afterQualification, question: 'Bagian mana yang lu kerjain di proyek sendiri?' } });
    assert.match(positive.question!, /proyek sendiri/u, 'experience outside employment remains available for follow-up');
    const sparse = buildCandidatePreparation(candidateEvidence('Keahlian komunikasi.', ''), resolved, targetJob, [],
        { coreIds: shared.interviewIds, alternativeOnly: true });
    const sparseTopics = taraTopics(attachLiveRoleTopics(sparse.payload, shared, resolved.liveAgenda), resolved, true);
    assert.ok(sparseTopics.every(topic => topic.alternative && topic.question.includes(topic.requiredSkill!.name)));
    const listedOnly = buildCandidatePreparation(candidateEvidence('Keahlian ' + fixture.listed + '.', ''), resolved, targetJob, [],
        { coreIds: shared.interviewIds, alternativeOnly: true });
    const recovered = taraTopics(attachLiveRoleTopics(listedOnly.payload, shared, resolved.liveAgenda), resolved, true);
    const listedTopic = recovered.find(topic => topic.requiredSkill?.name === fixture.listed)!;
    assert.equal(listedTopic.requiredSkill?.cvEvidence, 'CV_MENTION');
    assert.match(listedTopic.question, /^Di CV lo nyebut /u);
    assert.equal(liveBrief(recovered).find(topic => topic.criterionId === listedTopic.criterionId)?.context, 'CV_MENTION',
        'a verified CV mention stays visible when preparation recovers without a contextual claim');
}
console.log('Aligned rubric passed: versioned sources, equal CV weights, CV-first opening, and mandatory skill probes in three professions. Paid calls: 0.');
