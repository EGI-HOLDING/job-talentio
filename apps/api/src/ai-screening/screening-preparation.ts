type Dependency = { status: string; error?: string | null; text?: string | null } | null | undefined;
type CvSource = NonNullable<Dependency> & { checksum?: string | null; updatedAt?: Date };
type PreparationCv = {
    invitation?: { snapshot: unknown } | null;
    resumeVersion?: { checksum?: string | null; screeningSource?: CvSource | null } | null;
};

export function preparationCvSource(row: PreparationCv): CvSource | null | undefined {
    if (!row.invitation) return row.resumeVersion?.screeningSource;
    const frozen = row.invitation.snapshot as { cvText?: unknown; checksum?: unknown } | null;
    const text = typeof frozen?.cvText === 'string' ? frozen.cvText : null;
    const checksum = row.resumeVersion?.checksum;
    if (!text?.trim() || !checksum || (frozen?.checksum != null && frozen.checksum !== checksum))
        return { status: 'FAILED', error: 'CV_UNREADABLE' };
    return { status: 'READY', text, checksum };
}

export function screeningPreparation(row: {
    resumeId: string | null;
    package?: Dependency;
    currentPlan?: (NonNullable<Dependency> & { id: string }) | null;
} & PreparationCv) {
    const planId = row.currentPlan?.id ?? null;
    if (!row.resumeId) return { status: 'WAITING_CV' as const, planId, reason: null };
    const source = preparationCvSource(row);
    if (source?.status === 'READY' && 'text' in source && !source.text?.trim())
        return { status: 'FAILED' as const, planId, reason: 'CV_UNREADABLE' };
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
