import { employeeBenchmarkReviewHtml } from './employee-benchmark-review';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { EMPLOYEE_INTENT_VERSION, EMPLOYEE_INTENT_RANKING_VERSION, EMPLOYEE_PROFESSIONAL_WEIGHTS } from '@job-talentio/shared';
import { EmployeeOccupationIndex, type IntentRole } from './employee-occupation';
import { parseEmployeeEvidence, EMPLOYEE_EVIDENCE_PARSER, type IntentFacts } from './employee-intent-evidence';
import { evaluateIntent, compareIntent, type IntentJob, type IntentPreferences } from './employee-intent';
const occupations = [['Accountant', 'Akuntan', '241', 'Financial accounting'], ['Software Developer', 'Pengembang Perangkat Lunak', '251', 'Software development'], ['Mechanical Engineer', 'Insinyur Mesin', '214', 'Mechanical engineering'], ['Nursing Professional', 'Perawat Profesional', '222', 'Nursing care'], ['Primary School Teacher', 'Guru Sekolah Dasar', '234', 'Classroom teaching'], ['Chef', 'Koki', '343', 'Food preparation'], ['Shop Sales Assistant', 'Pramuniaga', '522', 'Retail sales'], ['Electrician', 'Teknisi Listrik', '741', 'Electrical installation'], ['Heavy Truck Driver', 'Pengemudi Truk Berat', '833', 'Heavy vehicle operation'], ['Graphic Designer', 'Desainer Grafis', '216', 'Graphic design']] as const;
export const benchmarkRoles: IntentRole[] = occupations.map(([name, nameId, family], i) => ({ id: 'role:' + i, name, nameId, familyId: 'isco:' + family, canonicalRoleId: null, matchingApproved: true, family: { id: 'isco:' + family, name: family, archivedAt: null }, aliases: [] }));
const neighborNames = ['Tax Staff', 'Systems Analyst', 'Civil Engineer', 'Midwifery Professional', 'Pre-primary School Teacher', 'Photographer', 'Shopkeeper', 'Electrical Mechanic', 'Bus Driver', 'Product Designer'];
export const benchmarkNeighbors: IntentRole[] = benchmarkRoles.map((r, i) => ({ ...r, id: 'neighbor:' + i, name: neighborNames[i], nameId: null }));
export const benchmarkIndex = new EmployeeOccupationIndex([...benchmarkRoles, ...benchmarkNeighbors]);
export const benchmarkSkills = occupations.map(row => ({ id: row[3], name: row[3], nameId: row[3], slug: row[3], matchingKind: 'PROFESSIONAL', aliases: [] }));
export function benchmarkJob(role: number, n: number): IntentJob { return { id: `job:${role}:${n}`, title: benchmarkRoles[role].name, jobTitleId: benchmarkRoles[role].id, companyId: 'company:' + n % 3, publishedAt: new Date(Date.UTC(2026, 9, n + 1)), countryId: n % 4 === 0 ? 'other' : 'id', cityId: n % 2 ? 'jakarta' : 'bandung', workMode: n % 3 === 0 ? 'REMOTE' : 'ONSITE', experienceYearsMin: n % 4, experienceLevel: null, salaryMin: 5000000, salaryMax: 5000000 + n * 1000000, currency: 'IDR', salaryPeriod: 'MONTHLY', jobSkills: [{ skillId: benchmarkSkills[role].id, isRequired: true, weight: 1, minLevel: n % 2 ? 'ADVANCED' : null, skill: { name: benchmarkSkills[role].name, matchingKind: 'PROFESSIONAL' } }], jobLanguages: [] }; }
const kinds = ['graduate', 'experienced', 'career-change', 'senior', 'incomplete', 'confirmed-gap'] as const;
export function makeEmployeeBenchmark() {
    const jobs = occupations.flatMap((_, role) => Array.from({ length: 12 }, (_, n) => benchmarkJob(role, n)));
    for (let role = 0; role < 10; role++)
        jobs.push({ ...benchmarkJob(role, 0), id: 'decoy:' + role, title: benchmarkNeighbors[role].name, jobTitleId: benchmarkNeighbors[role].id });
    const profiles = occupations.flatMap((occupation, role) => kinds.map((scenario, n) => {
        const title = benchmarkRoles[role].name, skill = benchmarkSkills[role].name;
        const careerTitle = scenario === 'career-change' ? benchmarkRoles[(role + 1) % 10].name : title;
        const cv = `Candidate ${role}-${n}\n${scenario === 'career-change' ? careerTitle : n % 2 ? occupation[1] : title}\nProfessional summary\nSeeking ${title} opportunities and professional development.\nSkills\n${scenario === 'incomplete' ? 'Communication' : skill}\nWork Experience\n${scenario === 'graduate' ? '' : `${scenario === 'senior' ? 'Senior ' : ''}${careerTitle}\nExample employer\nJanuary ${scenario === 'senior' ? '2014' : '2022'} - January 2026\nWorked in ${skill}.`}`;
        const facts = parseEmployeeEvidence(cv, benchmarkIndex, benchmarkSkills, []);
        // Scenario-specific evidence is explicit; no defaults pretend an unknown level was confirmed.
        if (scenario === 'confirmed-gap')
            for (const skill of facts.skills) {
                skill.level = 'BEGINNER';
                skill.confirmed = true;
                skill.source = 'USER';
            }
        if (scenario === 'experienced' || scenario === 'senior')
            for (const skill of facts.skills) {
                skill.level = 'ADVANCED';
                skill.confirmed = true;
                skill.source = 'USER';
            }
        const preferences: IntentPreferences = { selectedIds: [benchmarkRoles[role].id], cityId: 'jakarta', residenceCountryId: 'id', preferredCountries: [{ id: 'id' }], preferredWorkModes: ['REMOTE'], desiredSalaryMin: 8000000, desiredSalaryCurrency: 'IDR', desiredSalaryPeriod: 'MONTHLY' };
        if (scenario === 'career-change') {
            facts.roles = [{ key: 'previous-role', jobTitleId: benchmarkRoles[(role + 1) % 10].id, title: benchmarkRoles[(role + 1) % 10].name, confirmed: false, source: 'CV' }];
        }
        return { id: `profile:${role}:${scenario}`, family: occupation[2], scenario, split: (role + n) % 2 === 0 ? 'tuning' : 'evaluation', cv, preferences, facts };
    }));
    return { version: EMPLOYEE_INTENT_VERSION, rankingVersion: EMPLOYEE_INTENT_RANKING_VERSION, weights: EMPLOYEE_PROFESSIONAL_WEIGHTS, parserVersion: EMPLOYEE_EVIDENCE_PARSER, catalog: [...benchmarkRoles, ...benchmarkNeighbors], profiles, jobs };
}
export function benchmarkRank(preferences: IntentPreferences, facts: IntentFacts, jobs: IntentJob[]) { return jobs.map(job => ({ job, evaluation: evaluateIntent(preferences, facts, job, benchmarkIndex, new Date('2026-11-03')) })).filter(row => row.evaluation.eligibility.eligible).sort((a, b) => compareIntent(a.evaluation, b.evaluation) || (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id)).map(row => row.job.id); }
export function evaluateHumanLabels(dataset: ReturnType<typeof makeEmployeeBenchmark>, labels: {
    datasetHash: string;
    reviewedBy: string;
    reviewedAt: string;
    profiles: Array<{
        id: string;
        grades: Record<string, number>;
        eligibleJobIds: string[];
    }>;
}, performancePassed: boolean) {
    const hash = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
    if (labels.datasetHash !== hash || !labels.reviewedBy?.trim() || !Number.isFinite(Date.parse(labels.reviewedAt)))
        throw new Error('Human review must identify the reviewer, date, and exact locked dataset');
    let precision = 0, ndcg = 0, recall = 0, n = 0, leaks = 0;
    for (const profile of dataset.profiles) {
        const label = labels.profiles.find(l => l.id === profile.id);
        if (!label)
            throw new Error('Missing independent human labels: ' + profile.id);
        if (dataset.jobs.some(job => !Number.isInteger(label.grades[job.id]) || label.grades[job.id] < 0 || label.grades[job.id] > 3))
            throw new Error('Every job requires a human grade from 0 to 3');
        if (new Set(label.eligibleJobIds).size !== label.eligibleJobIds.length || label.eligibleJobIds.some(id => !dataset.jobs.some(j => j.id === id)))
            throw new Error('Invalid eligible job labels');
        if (profile.split !== 'evaluation')
            continue;
        const ranked = benchmarkRank(profile.preferences, profile.facts, dataset.jobs);
        const top = ranked.slice(0, 10);
        const eligible = new Set(label.eligibleJobIds);
        leaks += ranked.filter(id => !eligible.has(id)).length;
        const dcg = (grades: number[]) => grades.reduce((sum, g, i) => sum + (2 ** g - 1) / Math.log2(i + 2), 0);
        const ideal = label.eligibleJobIds.map(id => label.grades[id]).sort((a, b) => b - a).slice(0, 10);
        const idcg = dcg(ideal);
        precision += top.length ? top.filter(id => label.grades[id] >= 2).length / top.length : ideal.some(g => g >= 2) ? 0 : 1;
        ndcg += idcg ? dcg(top.map(id => label.grades[id])) / idcg : 1;
        recall += eligible.size ? ranked.filter(id => eligible.has(id)).length / eligible.size : ranked.length ? 0 : 1;
        n++;
    }
    return { version: dataset.version, parserVersion: dataset.parserVersion, rankingVersion: dataset.rankingVersion, families: new Set(dataset.profiles.filter(p => p.split === 'evaluation').map(p => p.family)).size, humanValidated: true, datasetHash: hash, reviewedBy: labels.reviewedBy, reviewedAt: labels.reviewedAt, zeroLeakage: leaks === 0, eligibleRecall: recall / n, precisionAt10: precision / n, ndcgAt10: ndcg / n, performancePassed, profiles: n };
}
if (require.main === module) {
    const dataset = makeEmployeeBenchmark();
    const hash = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
    const output = process.argv[2];
    if (!output)
        throw new Error('Pass an output directory outside tracked source (for example output/employee-intent-v3)');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'dataset.json'), JSON.stringify(dataset, null, 2));
    const template = { datasetHash: hash, reviewedBy: null, reviewedAt: null, instructions: 'Independently mark position/family eligibility for all jobs in the locked dataset and relevance 0-3 (0 irrelevant, 1 weak, 2 useful, 3 excellent). Do not copy machine ranking as human truth.', profiles: dataset.profiles.map(p => ({ id: p.id, split: p.split, eligibleJobIds: [], grades: Object.fromEntries(dataset.jobs.map(j => [j.id, null])) })) };
    fs.writeFileSync(path.join(output, 'human-review.html'), employeeBenchmarkReviewHtml(dataset, template));
    const labelFile = path.join(output, 'human-labels.json');
    const existing = fs.existsSync(labelFile) ? JSON.parse(fs.readFileSync(labelFile, 'utf8')) : null;
    if (!existing || !existing.reviewedBy && existing.profiles.every((p: any) => Object.values(p.grades).every(g => g === null)))
        fs.writeFileSync(path.join(output, 'human-labels.json'), JSON.stringify(template, null, 2));
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
        const start = performance.now();
        for (const p of dataset.profiles)
            benchmarkRank(p.preferences, p.facts, dataset.jobs);
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    fs.writeFileSync(path.join(output, 'machine-report.json'), JSON.stringify({ version: dataset.version, profiles: dataset.profiles.length, families: 10, jobs: dataset.jobs.length, datasetHash: hash, humanValidated: false, precisionAt10: null, ndcgAt10: null, batch60P95Ms: times[18] }, null, 2));
    console.log(JSON.stringify({ profiles: 60, families: 10, datasetHash: hash, humanValidated: false, output }));
}
