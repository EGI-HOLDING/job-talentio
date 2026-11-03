'use client';
import { useEffect, useState } from 'react';
import type { MatchInsights } from '@job-talentio/shared';
import { api, getSession } from '@/lib/api';
import { useSessionIdentity } from '@/lib/useSessionIdentity';
import { useI18n } from '@/lib/i18n';
import { EmployeeMatchReasons } from './EmployeeRecommendationState';
import {employeePositionPreferencesEnabled} from '@/lib/employeePositionPreferences';
export function EmployeeJobMatch({ jobId }: {
    jobId: string;
}) {
    const identity = useSessionIdentity();
    const { locale } = useI18n();
    const [data, setData] = useState<MatchInsights | null>(null), [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        setData(null);
        if (!employeePositionPreferencesEnabled || !identity || getSession()?.user.role !== 'EMPLOYEE')
            return;
        api<{
            matchInsights: MatchInsights | null;
        }>('/jobs/' + encodeURIComponent(jobId) + '/match-insights').then(result => { if (active && getSession()?.user.id === identity)
            setData(result.matchInsights); }).catch(() => { });
        return () => { active = false; };
    }, [jobId, identity, locale, revision]);
    useEffect(() => { const update = () => setRevision(n => n + 1); window.addEventListener('employee-matching-updated', update); return () => window.removeEventListener('employee-matching-updated', update); }, []);
    return <EmployeeMatchReasons insights={data}/>;
}
