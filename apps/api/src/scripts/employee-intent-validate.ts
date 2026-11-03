import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { makeEmployeeBenchmark, evaluateHumanLabels } from '../matching/employee-intent.benchmark';
import { employeeQualityGateAccepted } from '../matching/employee-quality-gate';
async function main() {
    const [datasetFile, labelsFile, performanceFile] = process.argv.slice(2);
    if (!performanceFile)
        throw Error('Usage: employee-intent-validate dataset.json human-labels.json database-integration-report.json [--apply-gate]');
    const dataset = JSON.parse(fs.readFileSync(datasetFile, 'utf8'));
    const current = makeEmployeeBenchmark();
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    if (hash(dataset) !== hash(current))
        throw Error('Dataset does not match the locked current benchmark');
    const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
    const performance = JSON.parse(fs.readFileSync(performanceFile, 'utf8'));
    const performancePassed = performance.suite === 'employee-intent-v3-real-db' && performance.passed >= 10 && performance.baselineP95Ms > 0 && performance.currentP95Ms > 0 && performance.currentP95Ms <= performance.baselineP95Ms * 1.2;
    const report = evaluateHumanLabels(dataset, labels, performancePassed);
    console.log(JSON.stringify({ ...report, accepted: employeeQualityGateAccepted(report) }, null, 2));
    if (!employeeQualityGateAccepted(report))
        throw Error('Activation quality thresholds have not passed');
    if (process.argv.includes('--apply-gate')) {
        const db = new PrismaClient();
        try {
            await db.featureFlag.upsert({ where: { key: 'employee_intent_v3_quality_gate' }, create: { key: 'employee_intent_v3_quality_gate', enabled: true, payload: report }, update: { enabled: true, payload: report } });
        }
        finally {
            await db.$disconnect();
        }
    }
}
void main().catch(e => { console.error(e.message); process.exitCode = 1; });
