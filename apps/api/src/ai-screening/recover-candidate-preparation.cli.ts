import { PrismaClient } from '@prisma/client';
import { recoverFailedCandidatePreparations } from './screening-candidate-recovery';

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) throw new Error('Use --dry-run or --apply');
    const db = new PrismaClient();
    try {
        console.log(JSON.stringify({ mode: args[0], ...(await recoverFailedCandidatePreparations(db, args[0] === '--apply')) }));
    } finally {
        await db.$disconnect();
    }
}

void main().catch(error => {
    console.error('Candidate preparation recovery failed', error instanceof Error ? error.name : 'UnknownError');
    process.exitCode = 1;
});
