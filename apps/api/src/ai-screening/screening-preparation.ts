type Dependency = { status: string; error?: string | null } | null | undefined;
export function screeningPreparation(row: {
    resumeId: string | null;
    package?: Dependency;
    currentPlan?: (NonNullable<Dependency> & { id: string }) | null;
    resumeVersion?: { screeningSource?: Dependency } | null;
}) {
    const planId = row.currentPlan?.id ?? null;
    if (!row.resumeId) return { status: 'WAITING_CV' as const, planId, reason: null };
    const source = row.resumeVersion?.screeningSource;
    const dependencies = [row.package, source, row.currentPlan];
    const failed = dependencies.filter(d => d?.status === 'FAILED');
    if (failed.length) {
        const errors = failed.map(d => d?.error ?? '').join(' ');
        const reason = /UNCERTAIN|REQUIRES_REVIEW|UNCONFIRMED|RETRY_LIMIT/.test(errors) ? 'RECOVERY_REQUIRED' :
            source?.status === 'FAILED' || /CV_UNREADABLE/.test(errors) ? 'CV_UNREADABLE' : 'PREPARATION_FAILED';
        return { status: 'FAILED' as const, planId, reason };
    }
    return { status: dependencies.every(d => d?.status === 'READY') ? 'READY' as const : 'PROCESSING' as const, planId, reason: null };
}
