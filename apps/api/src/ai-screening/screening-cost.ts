// Reasoning tokens are included in outputTokens; never bill them twice.
export type CallCost = {
    task: string;
    costUsd: number | null;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    status: string;
};
export function projectScreeningCost(calls: CallCost[], completed: number, started: number) {
    const shared = calls.filter(c => c.task === 'prepare').reduce((n, c) => n + (c.costUsd ?? 0), 0);
    const variable = calls.filter(c => c.task !== 'prepare').reduce((n, c) => n + (c.costUsd ?? 0), 0);
    const perStart = started ? variable / started : null, perCompleted = completed ? variable / completed : null;
    return { observed: { started, completed, sharedUsd: shared, variableUsd: variable, usdPerStarted: started ? (shared + variable) / started : null, usdPerCompleted: completed ? (shared + variable) / completed : null },
        scenarios: [50, 100, 200, 300, 400, 500, 750, 1000].map(applicants => ({ applicants, totalUsd: perCompleted === null ? null : shared + perCompleted * applicants, usdPerCompleted: perCompleted === null ? null : perCompleted + shared / applicants, usdPerStarted: perStart === null ? null : perStart + shared / applicants, targetMet: perCompleted !== null && perCompleted + shared / applicants <= 0.01 })) };
}
