'use client';

import { Link, localeHref } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { api, getSession, saveSession, AuthSession } from '@/lib/api';
import { localizedJobLocation } from '@/lib/location';
import { CvReviewModal, ParsedCv } from '@/components/CvReviewModal';
import { CreateResumeModal } from '@/components/resume/CreateResumeModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { BusyOverlay } from '@/components/ui/BusyOverlay';
import { WorkModal } from '@/components/ui/WorkModal';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { FormAlert, FormField, LabelText } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { CEFR_LEVELS } from '@/components/ui/LanguageChip';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { MatchRing } from '@/components/ui/MatchRing';
import { MatchBreakdownPanel } from '@/components/ui/MatchBreakdownPanel';
import { categoryIconLabel } from '@/lib/icons';
import { sanitizeMojibake } from '@/lib/text';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { waitForResumeParse } from '@/lib/cvParse';
import {
  EMPLOYEE_TAB_KEY,
  readStoredDashboardTab,
  storeDashboardTab,
} from '@/lib/dashboardTab';
import { MAX_RESUMES_PER_PROFILE } from '@job-talentio/shared';

type Tab = 'overview' | 'recommended' | 'applications' | 'saved' | 'alerts' | 'profile';
const EMPLOYEE_TABS: Tab[] = [
  'overview',
  'recommended',
  'applications',
  'saved',
  'alerts',
  'profile',
];

function isEmployeeTab(v: string): v is Tab {
  return (EMPLOYEE_TABS as string[]).includes(v);
}

function monthsBetween(start: string | Date, end?: string | Date | null) {
  const a = new Date(start);
  const b = end ? new Date(end) : new Date();
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

function formatDuration(
  t: (key: string) => string,
  start: string,
  end?: string | null,
  isCurrent?: boolean,
) {
  const months = monthsBetween(start, isCurrent || !end ? null : end);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const years = t('emp.durationYears').replace('{n}', String(y));
  const monthLabel = (n: number) => t('emp.durationMonths').replace('{n}', String(n));
  if (y && m) return `${years} ${monthLabel(m)}`;
  if (y) return years;
  return monthLabel(m || 1);
}

function dateInputValue(d?: string | Date | null) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function completeness(profile: any) {
  const checks = [
    {
      ok: Boolean(profile?.user?.emailVerified),
      labelKey: profile?.user?.email ? 'emp.checkVerifyEmail' : 'emp.checkAddEmail',
    },
    { ok: Boolean(profile?.user?.avatarUrl), labelKey: 'emp.checkAddPhoto' },
    { ok: Boolean(profile?.headline), labelKey: 'emp.checkAddHeadline' },
    { ok: Boolean(profile?.city), labelKey: 'emp.checkSetCity' },
    { ok: (profile?.skills || []).length >= 3, labelKey: 'emp.checkAddSkills' },
    { ok: (profile?.experiences || []).length >= 1, labelKey: 'emp.checkAddExperience' },
    { ok: (profile?.educations || []).length >= 1, labelKey: 'emp.checkAddEducation' },
    { ok: (profile?.languages || []).length >= 1, labelKey: 'emp.checkAddLanguage' },
    { ok: (profile?.resumes || []).length >= 1, labelKey: 'emp.checkAddResume' },
  ];
  const done = checks.filter((c) => c.ok).length;
  return { percent: Math.round((done / checks.length) * 100), checks, missing: checks.filter((c) => !c.ok) };
}

const LEVEL_ORDER = ['EXPERT', 'ADVANCED', 'INTERMEDIATE', 'BEGINNER'] as const;
const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
const LANG_LEVELS = CEFR_LEVELS;

function EmployeeDashboardInner() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab') || '';
  const [tab, setTab] = useState<Tab>(() => {
    if (isEmployeeTab(tabFromUrl)) return tabFromUrl;
    const stored = readStoredDashboardTab(EMPLOYEE_TAB_KEY);
    if (stored && isEmployeeTab(stored)) return stored;
    return 'overview';
  });
  const [addingResume, setAddingResume] = useState(false);
  const [showCreateResume, setShowCreateResume] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [skillsMeta, setSkillsMeta] = useState<any[]>([]);
  const [languagesMeta, setLanguagesMeta] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvParsing, setCvParsing] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvDragOver, setCvDragOver] = useState(false);
  const [draftAlertSkills, setDraftAlertSkills] = useState<Array<{ slug: string; name: string }>>([]);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyTelegram, setNotifyTelegram] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [cvReview, setCvReview] = useState<{ resumeId: string; parsed: ParsedCv } | null>(null);
  const [deleteCvId, setDeleteCvId] = useState<string | null>(null);
  const [deleteCvBusy, setDeleteCvBusy] = useState(false);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [expandedExp, setExpandedExp] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [breakdownId, setBreakdownId] = useState<string | null>(null);

  const editingExpId = openForm?.startsWith('edit-exp:') ? openForm.slice('edit-exp:'.length) : null;
  const editingEduId = openForm?.startsWith('edit-edu:') ? openForm.slice('edit-edu:'.length) : null;
  const editingCertId = openForm?.startsWith('edit-cert:') ? openForm.slice('edit-cert:'.length) : null;
  const editingExp = editingExpId
    ? (profile?.experiences || []).find((x: any) => x.id === editingExpId)
    : null;
  const editingEdu = editingEduId
    ? (profile?.educations || []).find((x: any) => x.id === editingEduId)
    : null;
  const editingCert = editingCertId
    ? (profile?.certifications || []).find((x: any) => x.id === editingCertId)
    : null;

  useEffect(() => {
    if (isEmployeeTab(tabFromUrl) && tabFromUrl !== tab) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    storeDashboardTab(EMPLOYEE_TAB_KEY, tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    const qs = params.toString();
    if (qs !== searchParams.toString()) {
      router.replace(`/dashboard/employee?${qs}`);
    }
  }, [tab, router, searchParams]);

  async function load() {
    const session = getSession();
    if (!session || session.user.role !== 'EMPLOYEE') {
      window.location.href = localeHref('/login');
      return;
    }
    const [p, a, r, al, c, sk, langs, sv] = await Promise.all([
      api('/profiles/me'),
      api('/applications/mine'),
      api('/jobs/recommended').catch(() => []),
      api('/alerts'),
      api('/meta/cities', { auth: false }),
      api('/meta/skills', { auth: false }),
      api('/meta/languages', { auth: false }).catch(() => []),
      api('/profiles/me/saved-jobs').catch(() => []),
    ]);
    setProfile(p);
    setApps(a as any[]);
    setRecommended(r as any[]);
    setAlerts(al as any[]);
    setCities(c as any[]);
    setSkillsMeta(sk as any[]);
    setLanguagesMeta(langs as any[]);
    setSaved(sv as any[]);
    setTelegramLinked(Boolean(getSession()?.user.telegramLinked));
    api<AuthSession>('/auth/me')
      .then((fresh) => {
        saveSession(fresh);
        setTelegramLinked(Boolean(fresh.user.telegramLinked));
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function requestEmailVerification() {
    setVerifyBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await api<{ message?: string; alreadyVerified?: boolean; email: string }>(
        '/auth/request-verification',
        { method: 'POST' },
      );
      if (r.alreadyVerified) {
        const session = getSession();
        if (session) {
          const next: AuthSession = {
            ...session,
            user: { ...session.user, emailVerified: true },
          };
          saveSession(next);
        }
        setProfile((p: any) =>
          p ? { ...p, user: { ...p.user, emailVerified: true } } : p,
        );
        setMsg(t('emailVerifiedBadge'));
      } else {
        setMsg(r.message || `${t('verifyEmailSentTo')} ${r.email}`);
      }
    } catch (e) {
      setError((e as Error).message || t('verifyEmailFailed'));
    } finally {
      setVerifyBusy(false);
    }
  }

  async function updateProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify({
        headline: fd.get('headline'),
        summary: fd.get('summary'),
        citySlug: fd.get('citySlug') || null,
        phone: fd.get('phone') || undefined,
        visibility: fd.get('visibility') || undefined,
        desiredPosition: fd.get('desiredPosition'),
        desiredSalaryMin: fd.get('desiredSalaryMin')
          ? Number(fd.get('desiredSalaryMin'))
          : null,
      }),
    });
    setMsg(t('emp.profileUpdated'));
    await load();
  }

  async function addSkillPick(skill: {
    slug: string;
    name: string;
    isNew?: boolean;
    level?: string;
  }) {
    await api('/profiles/me/skills', {
      method: 'POST',
      body: JSON.stringify(
        skill.slug
          ? { slug: skill.slug, level: skill.level || 'INTERMEDIATE' }
          : { name: skill.name, level: skill.level || 'INTERMEDIATE' },
      ),
    });
    setMsg(
      t(skill.isNew ? 'emp.skillResolvedSaved' : 'emp.skillAdded').replace(
        '{name}',
        skill.name,
      ),
    );
    await load();
  }

  async function updateSkillLevel(id: string, level: string) {
    await api(`/profiles/me/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ level }),
    });
    await load();
  }

  async function updateLanguageLevel(id: string, level: string) {
    await api(`/profiles/me/languages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ level }),
    });
    await load();
  }

  async function removeItem(kind: string, id: string) {
    if (kind === 'resumes') {
      setDeleteCvId(id);
      return;
    }
    const res = await api<{ softDeleted?: boolean; message?: string }>(
      `/profiles/me/${kind}/${id}`,
      { method: 'DELETE' },
    );
    if (kind === 'resumes' && res?.softDeleted && res.message) {
      setMsg(res.message);
    }
    await load();
  }

  async function confirmDeleteCv() {
    if (!deleteCvId) return;
    setDeleteCvBusy(true);
    setError('');
    try {
      const res = await api<{ softDeleted?: boolean; message?: string }>(
        `/profiles/me/resumes/${deleteCvId}`,
        { method: 'DELETE' },
      );
      if (res?.softDeleted && res.message) setMsg(res.message);
      else setMsg(t('emp.cvRemoved'));
      setDeleteCvId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('emp.deleteFailed'));
    } finally {
      setDeleteCvBusy(false);
    }
  }

  async function withdrawApplication(appId: string) {
    const ok = await confirm({
      title: t('emp.withdrawConfirm'),
      tone: 'danger',
      confirmLabel: t('emp.withdraw'),
    });
    if (!ok) return;
    try {
      await api(`/applications/${appId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'WITHDRAWN' }),
      });
      setMsg(t('emp.applicationWithdrawn'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('emp.withdrawFailed'));
    }
  }

  async function deleteAlert(id: string) {
    const ok = await confirm({
      title: t('emp.deleteAlertConfirm'),
      tone: 'danger',
      confirmLabel: t('emp.delete'),
    });
    if (!ok) return;
    await api(`/alerts/${id}`, { method: 'DELETE' });
    await load();
  }

  async function toggleAlert(id: string, isActive: boolean) {
    await api(`/alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !isActive }),
    });
    await load();
  }

  async function patchAlertChannel(
    id: string,
    field: 'notifyInApp' | 'notifyEmail' | 'notifyTelegram',
    value: boolean,
  ) {
    await api(`/alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: value }),
    });
    await load();
  }

  async function saveExperience(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      companyName: fd.get('companyName'),
      title: fd.get('title'),
      description: fd.get('description') || undefined,
      citySlug: fd.get('citySlug') || undefined,
      startDate: fd.get('startDate'),
      endDate: fd.get('endDate') || null,
      isCurrent: fd.get('isCurrent') === 'on',
    };
    if (editingExpId) {
      await api(`/profiles/me/experiences/${editingExpId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMsg(t('emp.experienceUpdated'));
    } else {
      await api('/profiles/me/experiences', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg(t('emp.experienceAdded'));
    }
    setOpenForm(null);
    await load();
  }

  async function saveEducation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      school: fd.get('school'),
      degree: fd.get('degree') || undefined,
      field: fd.get('field') || undefined,
      startDate: fd.get('startDate') || null,
      endDate: fd.get('endDate') || null,
    };
    if (editingEduId) {
      await api(`/profiles/me/educations/${editingEduId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMsg(t('emp.educationUpdated'));
    } else {
      await api('/profiles/me/educations', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg(t('emp.educationAdded'));
    }
    setOpenForm(null);
    await load();
  }

  async function saveCertification(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: fd.get('name'),
      issuer: fd.get('issuer') || undefined,
      issuedAt: fd.get('issuedAt') || null,
      expiresAt: fd.get('expiresAt') || null,
      credentialUrl: fd.get('credentialUrl') || '',
    };
    if (editingCertId) {
      await api(`/profiles/me/certifications/${editingCertId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMsg(t('emp.certificationUpdated'));
    } else {
      await api('/profiles/me/certifications', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg(t('emp.certificationAdded'));
    }
    setOpenForm(null);
    await load();
  }

  async function addLanguagePick(item: {
    slug: string;
    name: string;
    code?: string;
    isNew?: boolean;
    level?: string;
  }) {
    await api('/profiles/me/languages', {
      method: 'POST',
      body: JSON.stringify(
        item.code || item.slug
          ? { code: item.code || item.slug, level: item.level || 'B1' }
          : { name: item.name, level: item.level || 'B1' },
      ),
    });
    setMsg(
      t(item.isNew ? 'emp.languageResolvedSaved' : 'emp.languageAdded').replace(
        '{name}',
        item.name,
      ),
    );
    await load();
  }

  async function setPrimaryResume(id: string) {
    await api(`/profiles/me/resumes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    });
    setMsg(t('emp.primaryResumeUpdated'));
    await load();
  }

  function openCreateResume() {
    setError('');
    if ((profile?.resumes || []).length >= MAX_RESUMES_PER_PROFILE) {
      setError(t('resumeQuotaReached').replace('{max}', String(MAX_RESUMES_PER_PROFILE)));
      return;
    }
    setShowCreateResume(true);
  }

  function pickCvFile(file: File | null | undefined) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const okMime =
      file.type === 'application/pdf' ||
      file.type === 'application/msword' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lower.endsWith('.pdf') ||
      lower.endsWith('.docx') ||
      lower.endsWith('.doc');
    if (!okMime) {
      setError(t('resumePdfOnly'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t('resumeFileTooLarge'));
      return;
    }
    setError('');
    setCvFile(file);
  }

  async function uploadCv(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cvFile) {
      setError(t('resumePdfRequired'));
      return;
    }
    setUploading(true);
    setCvBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', cvFile);
      fd.append('parse', 'true');
      const resume = await api<{ id: string }>(
        '/profiles/me/resumes/upload',
        { method: 'POST', body: fd },
      );
      setCvFile(null);
      await load();
      setCvParsing(true);
      const parse = await waitForResumeParse(resume.id);
      await load();
      if (parse.parseStatus === 'READY' && parse.parsedData) {
        setMsg(t('cvParseReady'));
        setCvReview({ resumeId: resume.id, parsed: parse.parsedData as ParsedCv });
      } else if (parse.parseStatus === 'FAILED') {
        setError(parse.parseError || t('cvParseFailed'));
      } else {
        setError(t('ui.cvParseStillRunning'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('emp.uploadFailed'));
    } finally {
      setCvParsing(false);
      setCvBusy(false);
      setUploading(false);
    }
  }

  async function downloadResume(id: string) {
    const res = await api<{ url: string }>(`/profiles/me/resumes/${id}/download`);
    window.open(res.url, '_blank', 'noopener,noreferrer');
  }

  async function attachFileToResume(resumeId: string, file: File) {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/profiles/me/resumes/${resumeId}/file`, { method: 'POST', body: fd });
      setMsg(t('resumeFileAttached'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('emp.attachFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function unsaveJob(jobId: string) {
    await api(`/profiles/me/saved-jobs/${jobId}`, { method: 'DELETE' });
    await load();
  }

  async function createAlert(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/alerts', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        query: fd.get('query'),
        citySlug: fd.get('citySlug') || undefined,
        skillSlugs: draftAlertSkills.map((s) => s.slug).filter(Boolean),
        frequency: fd.get('frequency'),
        notifyInApp,
        notifyEmail,
        notifyTelegram: notifyTelegram && telegramLinked,
      }),
    });
    setDraftAlertSkills([]);
    setNotifyInApp(true);
    setNotifyEmail(true);
    setNotifyTelegram(false);
    await load();
  }

  const complete = useMemo(() => (profile ? completeness(profile) : null), [profile]);
  const skillsByLevel = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const lvl of LEVEL_ORDER) map[lvl] = [];
    for (const s of profile?.skills || []) {
      const lvl = s.level || 'INTERMEDIATE';
      (map[lvl] || (map[lvl] = [])).push(s);
    }
    return map;
  }, [profile]);

  const showExpForm = openForm === 'exp' || Boolean(editingExpId);
  const showEduForm = openForm === 'edu' || Boolean(editingEduId);
  const showCertForm = openForm === 'cert' || Boolean(editingCertId);

  if (!profile && !error) return <DashboardSkeleton />;

  return (
    <div className="shell dash-grid">
      <WorkModal open={cvParsing} title={t('ui.parsingCv')} />
      {cvReview && (
        <CvReviewModal
          resumeId={cvReview.resumeId}
          parsed={cvReview.parsed}
          onClose={() => setCvReview(null)}
          onImported={async () => {
            setCvReview(null);
            setMsg(t('emp.cvImported'));
            setTab('profile');
            await load();
          }}
        />
      )}
      {deleteCvId && (
        <ConfirmModal
          title={t('deleteCvTitle')}
          message={t('deleteCvMessage')}
          confirmLabel={t('deleteCvConfirm')}
          cancelLabel={t('cancel')}
          danger
          busy={deleteCvBusy}
          onCancel={() => {
            if (!deleteCvBusy) setDeleteCvId(null);
          }}
          onConfirm={confirmDeleteCv}
        />
      )}
      <CreateResumeModal
        open={showCreateResume}
        busy={addingResume}
        defaultJobTitle={profile?.desiredPosition || profile?.headline || ''}
        onCancel={() => setShowCreateResume(false)}
        onCreated={async (result) => {
          setAddingResume(true);
          try {
            setShowCreateResume(false);
            setMsg(t('createResume'));
            await load();
            if (result.method === 'builder') {
              router.push(
                `/dashboard/employee/resume-builder?resumeId=${encodeURIComponent(result.id)}`,
              );
            }
          } finally {
            setAddingResume(false);
          }
        }}
      />
      <aside className="dash-nav">
        {(
          [
            ['overview', t('overview')],
            ['recommended', t('recommended')],
            ['applications', t('applications')],
            ['saved', t('savedJobs')],
            ['alerts', t('alerts')],
            ['profile', t('profile')],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </aside>

      <section>
        {error && <FormAlert>{error}</FormAlert>}
        {msg && <FormAlert tone="success">{msg}</FormAlert>}

        {tab === 'overview' && (
          <div>
            {complete && (
              <div className="card completeness-card" style={{ marginBottom: '1rem' }}>
                <div className="completeness-head">
                  <div>
                    <h3 style={{ margin: 0 }}>{t('emp.profileStrength')}</h3>
                    <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                      {t('emp.profileStrengthHint')}
                    </p>
                  </div>
                  <div className="completeness-score">{complete.percent}%</div>
                </div>
                <div className="completeness-bar">
                  <span style={{ width: `${complete.percent}%` }} />
                </div>
                {complete.missing.length > 0 && (
                  <div className="chips" style={{ marginTop: '0.75rem' }}>
                    {complete.missing.slice(0, 4).map((m) => (
                      <button
                        key={m.labelKey}
                        type="button"
                        className="chip"
                        onClick={() => setTab('profile')}
                      >
                        + {t(m.labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid-2">
            <div className="card">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="avatar avatar-lg"
                  src={profile?.user?.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${profile?.user?.fullName}`}
                  alt=""
                />
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>{profile?.user?.fullName}</h2>
                  <p className="muted" style={{ margin: '0.25rem 0' }}>{sanitizeMojibake(profile?.headline)}</p>
                  <p className="muted" style={{ margin: 0 }}>{profile?.city?.name}</p>
                </div>
              </div>
            </div>
            <div className="card">
              <h3>{t('emp.quickStats')}</h3>
              <p><strong>{apps.length}</strong> {t('emp.statApplications')}</p>
              <p><strong>{recommended.length}</strong> {t('emp.statRecommendedJobs')}</p>
              <p><strong>{(profile?.skills || []).length}</strong> {t('emp.statSkills')}</p>
              <p>
                {t('emp.upcomingInterviews')}:{' '}
                {apps.reduce((n, a) => n + (a.interviews?.length || 0), 0)}
              </p>
            </div>
          </div>
          </div>
        )}

        {tab === 'recommended' && (
          <div>
            <h2 className="section-title">{t('emp.jobsMatchedTitle')}</h2>
            {recommended.map((item) => {
              const rowId = `rec-${item.job.id}`;
              const open = breakdownId === rowId;
              return (
                <div key={item.job.id} className="job-card" style={{ display: 'block' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.85rem', alignItems: 'center' }}>
                    <Link href={`/jobs/${item.job.id}`} className="company-logo-tile" aria-hidden>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="company-logo"
                        src={
                          item.job.company?.logoUrl ||
                          `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(item.job.company?.name || 'Co')}`
                        }
                        alt=""
                      />
                    </Link>
                    <div>
                      <Link href={`/jobs/${item.job.id}`}>
                        <h3 style={{ margin: 0 }}>{sanitizeMojibake(item.job.title)}</h3>
                      </Link>
                      <div className="job-meta">
                        <span>{item.job.company?.name}</span>
                        <span>{localizedJobLocation(item.job, t)}</span>
                        {item.job.category && (
                          <span>
                            {categoryIconLabel(item.job.category.slug, item.job.category.icon)}
                            {item.job.category.name}
                          </span>
                        )}
                      </div>
                      {item.matchScore != null && (
                        <>
                          <button
                            type="button"
                            className="badge match"
                            style={{ marginTop: '0.55rem', border: 0, cursor: 'pointer' }}
                            onClick={() => setBreakdownId(open ? null : rowId)}
                          >
                            {t('match')} {item.matchScore}% | {t('emp.details')}
                          </button>
                          {open && item.matchBreakdown && (
                            <MatchBreakdownPanel breakdown={item.matchBreakdown} style={{ marginTop: '0.5rem' }} />
                          )}
                          <div className="match-bar" style={{ marginTop: '0.45rem' }}>
                            <span style={{ width: `${item.matchScore}%` }} />
                          </div>
                        </>
                      )}
                    </div>
                    {item.matchScore != null && <MatchRing score={item.matchScore} />}
                  </div>
                </div>
              );
            })}
            {!recommended.length && (
              <p className="muted">
                {profile?.skills?.length ||
                profile?.headline ||
                profile?.desiredPosition ||
                (profile?.experiences || []).some((row: { title?: string | null }) => row.title) ? (
                  <>
                    {t('emp.recommendedEmptyNoOverlap')}{' '}
                    <Link href="/jobs">{t('jobs')}</Link>
                  </>
                ) : (
                  <>
                    {t('emp.recommendedEmpty')}{' '}
                    <Link href="/dashboard/employee?tab=profile">{t('profile')}</Link>
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {tab === 'applications' && (
          <div>
            <h2 className="section-title">{t('emp.myApplications')}</h2>
            {apps.map((a) => {
              const open = breakdownId === a.id;
              return (
                <div key={a.id} className="card" style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Link href={`/jobs/${a.jobPost.id}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>
                        {sanitizeMojibake(a.jobPost.title)}
                      </Link>
                      <p className="muted" style={{ margin: '0.25rem 0' }}>
                        {a.jobPost.company?.name} | {enumLabel('applicationStatus', a.status)}
                      </p>
                      {a.matchScore != null && (
                        <>
                          <button
                            type="button"
                            className="badge match"
                            style={{ border: 0, cursor: 'pointer' }}
                            onClick={() => setBreakdownId(open ? null : a.id)}
                          >
                            {t('match')} {a.matchScore}% | {t('emp.details')}
                          </button>
                          {open && a.matchBreakdown && (
                            <MatchBreakdownPanel breakdown={a.matchBreakdown} style={{ marginTop: '0.5rem' }} />
                          )}
                        </>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {(a.interviews || []).map((iv: any) => (
                        <div key={iv.id} className="badge" style={{ display: 'block', marginBottom: 4 }}>
                          {t('emp.interview')} {new Date(iv.scheduledAt).toLocaleString()}
                        </div>
                      ))}
                      <div className="chips" style={{ justifyContent: 'flex-end' }}>
                        {a.jobPost.company?.chatPeerUserId ? (
                          <Link
                            href={`/messages?peer=${a.jobPost.company.chatPeerUserId}&job=${a.jobPost.id}`}
                            className="chip"
                            style={{ fontSize: '0.78rem' }}
                          >
                            {t('chatWithRecruiter')}
                          </Link>
                        ) : null}
                        {a.status !== 'WITHDRAWN' &&
                          a.status !== 'HIRED' &&
                          a.status !== 'REJECTED' && (
                            <button
                              type="button"
                              className="chip"
                              onClick={() => withdrawApplication(a.id)}
                            >
                              {t('emp.withdraw')}
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'saved' && (
          <div>
            <h2 className="section-title">{t('savedJobs')}</h2>
            {saved.length === 0 && <p className="muted">{t('emp.savedEmpty')}</p>}
            {saved.map((s) => (
              <div key={s.id} className="card" style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <Link href={`/jobs/${s.jobPost.id}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {s.jobPost.title}
                    </Link>
                    <p className="muted" style={{ margin: '0.25rem 0' }}>
                      {s.jobPost.company?.name} | {localizedJobLocation(s.jobPost, t)} |{' '}
                      {enumLabel('jobStatus', s.jobPost.status)}
                    </p>
                  </div>
                  <button type="button" className="secondary" onClick={() => unsaveJob(s.jobPost.id)}>
                    {t('emp.remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'alerts' && (
          <div className="grid-2">
            <div className="card">
              <h3>{t('emp.createAlert')}</h3>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              {!telegramLinked ? (
                <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
                  {t('emp.alertTelegramLinkHint')}{' '}
                  <Link href="/settings#security">{t('settings')}</Link>
                </p>
              ) : null}
              <form className="form-stack" onSubmit={createAlert}>
                <label>
                  <LabelText required>{t('emp.name')}</LabelText>
                  <input name="name" required />
                </label>
                <FormField label={t('emp.keywords')} hint={t('emp.keywordsHint')}>
                  <input name="query" placeholder={t('emp.keywordsPlaceholder')} />
                </FormField>
                <label>
                  <LabelText>{t('city')}</LabelText>
                  <select name="citySlug">
                    <option value="">{t('any')}</option>
                    {cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <LabelText>{t('skills')}</LabelText>
                  <div className="chips" style={{ margin: '0.4rem 0' }}>
                    {draftAlertSkills.map((s) => (
                      <span key={s.slug} className="badge">
                        {s.name}
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 6, padding: 0 }}
                          onClick={() =>
                            setDraftAlertSkills((prev) => prev.filter((x) => x.slug !== s.slug))
                          }
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <SkillCombobox
                    levelSelect={false}
                    allowCreate={false}
                    submitLabel={t('emp.addSkillToAlert')}
                    onPick={(skill) => {
                      if (!skill.slug) return;
                      setDraftAlertSkills((prev) =>
                        prev.some((p) => p.slug === skill.slug)
                          ? prev
                          : [...prev, { slug: skill.slug, name: skill.name }],
                      );
                    }}
                  />
                </div>
                <label>
                  <LabelText>{t('emp.frequency')}</LabelText>
                  <select name="frequency" defaultValue="DAILY">
                    <option value="DAILY">{t('emp.daily')}</option>
                    <option value="WEEKLY">{t('emp.weekly')}</option>
                  </select>
                </label>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <LabelText>{t('emp.alertChannels')}</LabelText>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
                    <input
                      type="checkbox"
                      checked={notifyInApp}
                      onChange={(e) => setNotifyInApp(e.target.checked)}
                    />
                    {t('emp.alertChannelInApp')}
                  </label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.checked)}
                    />
                    {t('emp.alertChannelEmail')}
                  </label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(notifyTelegram && telegramLinked)}
                      disabled={!telegramLinked}
                      onChange={(e) => setNotifyTelegram(e.target.checked)}
                    />
                    {t('emp.alertChannelTelegram')}
                  </label>
                </fieldset>
                <button type="submit">{t('emp.saveAlert')}</button>
              </form>
            </div>
            <div>
              {alerts.map((a) => (
                <div key={a.id} className="card" style={{ marginBottom: '0.5rem' }}>
                  <strong>{a.name}</strong>
                  <p className="muted" style={{ margin: '0.25rem 0' }}>
                    {a.city?.name || t('emp.anyCity')} | {a.frequency} |{' '}
                    {a.isActive ? t('emp.active') : t('emp.paused')}
                  </p>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0' }}>
                    {[
                      a.notifyInApp !== false ? t('emp.alertChannelInApp') : null,
                      a.notifyEmail !== false ? t('emp.alertChannelEmail') : null,
                      a.notifyTelegram ? t('emp.alertChannelTelegram') : null,
                    ]
                      .filter(Boolean)
                      .join(' | ') || t('emp.paused')}
                  </p>
                  {a.notifyTelegram && !telegramLinked && (
                    <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0' }}>
                      {t('emp.alertTelegramNotLinked')}{' '}
                      <Link href="/settings#security">{t('settings')}</Link>
                    </p>
                  )}
                  {(a.skills || []).length > 0 && (
                    <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0' }}>
                      {t('skills')}:{' '}
                      {a.skills.map((s: any) => s.skill?.name).filter(Boolean).join(', ')}
                    </p>
                  )}
                  <div className="chips">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => patchAlertChannel(a.id, 'notifyInApp', a.notifyInApp === false)}
                    >
                      {t('emp.alertChannelInApp')}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => patchAlertChannel(a.id, 'notifyEmail', a.notifyEmail === false)}
                    >
                      {t('emp.alertChannelEmail')}
                    </button>
                    <button
                      type="button"
                      className={a.notifyTelegram && telegramLinked ? 'chip active' : 'chip'}
                      disabled={!telegramLinked && !a.notifyTelegram}
                      onClick={() => {
                        if (!telegramLinked) {
                          if (a.notifyTelegram) {
                            void patchAlertChannel(a.id, 'notifyTelegram', false);
                          }
                          return;
                        }
                        void patchAlertChannel(a.id, 'notifyTelegram', !a.notifyTelegram);
                      }}
                    >
                      {t('emp.alertChannelTelegram')}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => toggleAlert(a.id, a.isActive)}
                    >
                      {a.isActive ? t('emp.pause') : t('emp.resumeAlert')}
                    </button>
                    <button type="button" className="chip" onClick={() => deleteAlert(a.id)}>
                      {t('emp.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'profile' && profile && (
          <div className="career-page profile-page">
            <div className="card profile-block">
              <h2 className="section-title" style={{ marginTop: 0 }}>
                {profile.user?.email ? t('verifyEmailTitle') : t('addEmailTitle')}
              </h2>
              {profile.user?.email ? (
                <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
                  {profile.user.email} -{' '}
                  {profile.user?.emailVerified ? (
                    <span style={{ color: '#047857', fontWeight: 600 }}>{t('emailVerifiedBadge')}</span>
                  ) : (
                    <span style={{ color: '#b45309', fontWeight: 600 }}>{t('emailUnverifiedBadge')}</span>
                  )}
                </p>
              ) : (
                <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
                  {t('addEmailDashboardHint')}
                </p>
              )}
              {!profile.user?.email ? (
                <Link href="/settings" style={{ color: 'var(--accent)' }}>
                  {t('addEmailGoToSettings')}
                </Link>
              ) : !profile.user?.emailVerified ? (
                <>
                  <p className="muted" style={{ fontSize: '0.9rem' }}>
                    {t('verifyEmailProfileHint')}
                  </p>
                  <button
                    type="button"
                    disabled={verifyBusy}
                    onClick={() => requestEmailVerification()}
                  >
                    {verifyBusy ? t('verifyEmailSending') : t('verifyEmailCta')}
                  </button>
                </>
              ) : null}
            </div>

            <div className="card profile-block">
              <h2 className="section-title" style={{ marginTop: 0 }}>{t('emp.basics')}</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
                {t('emp.basicsHint')}
              </p>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={updateProfile} key={`profile-${profile.updatedAt || profile.id}`}>
                <label>
                  <LabelText>{t('emp.headline')}</LabelText>
                  <input name="headline" defaultValue={sanitizeMojibake(profile.headline) || ''} />
                </label>
                <label>
                  <LabelText>{t('emp.summary')}</LabelText>
                  <textarea name="summary" rows={4} defaultValue={sanitizeMojibake(profile.summary) || ''} />
                </label>
                <div className="grid-2">
                  <label>
                    <LabelText>{t('emp.phone')}</LabelText>
                    <input name="phone" type="tel" defaultValue={profile.phone || ''} placeholder="+998..." />
                  </label>
                  <label>
                    <LabelText>{t('emp.visibility')}</LabelText>
                    <select name="visibility" defaultValue={profile.visibility || 'TO_REGISTERED_RECRUITERS'}>
                      <option value="PUBLIC">{t('emp.visibilityPublic')}</option>
                      <option value="TO_REGISTERED_RECRUITERS">{t('emp.visibilityRecruiters')}</option>
                      <option value="PRIVATE">{t('emp.visibilityPrivate')}</option>
                    </select>
                  </label>
                </div>
                <label>
                  <LabelText>{t('city')}</LabelText>
                  <select name="citySlug" defaultValue={profile.city?.slug || ''}>
                    <option value="">-</option>
                    {cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid-2">
                  <label>
                    <LabelText>{t('emp.desiredPosition')}</LabelText>
                    <input name="desiredPosition" defaultValue={sanitizeMojibake(profile.desiredPosition) || ''} />
                  </label>
                  <label>
                    <LabelText>{t('emp.desiredSalary')}</LabelText>
                    <NumberInput
                      name="desiredSalaryMin"
                      defaultValue={profile.desiredSalaryMin}
                      placeholder={t('emp.desiredSalaryPlaceholder')}
                      min={0}
                      aria-label={t('emp.desiredSalaryAria')}
                    />
                  </label>
                </div>
                <button type="submit">{t('emp.saveBasics')}</button>
              </form>
            </div>

            <BusyOverlay
              active={cvBusy}
              label={cvParsing ? t('ui.parsingCv') : t('emp.uploading')}
              className="card profile-block"
            >
              <h2 className="section-title" style={{ marginTop: 0 }}>{t('emp.importFromCv')}</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
                {t('emp.importFromCvHint')}
              </p>
              <form onSubmit={uploadCv} className="cv-upload-form">
                <div
                  className={`cv-upload-drop${cvFile ? ' is-selected' : ''}${cvDragOver ? ' is-dragover' : ''}${uploading ? ' is-disabled' : ''}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setCvDragOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setCvDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setCvDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setCvDragOver(false);
                    pickCvFile(e.dataTransfer.files?.[0]);
                  }}
                >
                  <input
                    type="file"
                    accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                    disabled={uploading}
                    aria-label={t('uploadCv')}
                    onChange={(e) => {
                      pickCvFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  {cvFile ? (
                    <div className="cv-upload-selected">
                      <span className="cv-upload-icon" aria-hidden>
                        PDF
                      </span>
                      <div className="cv-upload-selected-meta">
                        <span className="muted" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                          {t('uploadCvSelected')}
                        </span>
                        <strong title={cvFile.name}>{cvFile.name}</strong>
                        <span>{(cvFile.size / 1024).toFixed(0)} KB</span>
                      </div>
                      <span className="cv-upload-browse">{t('uploadCvChange')}</span>
                    </div>
                  ) : (
                    <>
                      <span className="cv-upload-icon" aria-hidden>
                        PDF
                      </span>
                      <strong>{t('uploadCv')}</strong>
                      <span className="cv-upload-hint">{t('uploadCvHint')}</span>
                      <span className="cv-upload-browse">{t('uploadCvBrowse')}</span>
                    </>
                  )}
                </div>
                <div className="cv-upload-actions">
                  <button type="submit" className="cta" disabled={uploading || !cvFile}>
                    {uploading ? t('emp.uploading') : t('uploadCvParse')}
                  </button>
                  {cvFile && !uploading && (
                    <button type="button" className="ghost" onClick={() => setCvFile(null)}>
                      {t('cancel')}
                    </button>
                  )}
                </div>
              </form>
            </BusyOverlay>

            <div className="profile-block" style={{ marginBottom: '0.35rem' }}>
              <h2 className="section-title" style={{ margin: 0 }}>{t('emp.careerHistory')}</h2>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
                {t('emp.careerHistoryHint')}
              </p>
            </div>

            <div className="card profile-block">
              <div className="cv-section-head">
                <h3 style={{ margin: 0 }}>{t('skills')}</h3>
                <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'skill' ? null : 'skill')}>
                  {openForm === 'skill' ? t('closeDialog') : `+ ${t('addSkill')}`}
                </button>
              </div>
              {LEVEL_ORDER.map((lvl) =>
                (skillsByLevel[lvl] || []).length ? (
                  <div key={lvl} className="profile-skill-group">
                    <div className="profile-group-label">{enumLabel('skillLevel', lvl)}</div>
                    <ul className="profile-list">
                      {skillsByLevel[lvl].map((s: any) => (
                        <li key={s.id} className="profile-list-row">
                          <span className="profile-list-title">{s.skill?.name}</span>
                          <div className="profile-list-actions">
                            <select
                              aria-label={t('emp.levelFor').replace('{name}', s.skill?.name)}
                              value={s.level || 'INTERMEDIATE'}
                              onChange={(e) => updateSkillLevel(s.id, e.target.value)}
                            >
                              {SKILL_LEVELS.map((l) => (
                                <option key={l} value={l}>{enumLabel('skillLevel', l)}</option>
                              ))}
                            </select>
                            <button type="button" className="ghost" onClick={() => removeItem('skills', s.id)}>
                              {t('emp.remove')}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
              {!(profile.skills || []).length && <p className="muted">{t('emp.noSkills')}</p>}
              {openForm === 'skill' && (
                <div style={{ marginTop: '1rem' }}>
                  <p className="required-note">{t('requiredFieldsNote')}</p>
                  <SkillCombobox
                    onPick={async (s) => {
                      await addSkillPick(s);
                      setOpenForm(null);
                    }}
                    submitLabel={t('emp.saveSkill')}
                  />
                </div>
              )}
            </div>

            <div className="card profile-block">
              <div className="cv-section-head">
                <h3 style={{ margin: 0 }}>{t('emp.workExperience')}</h3>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setOpenForm(showExpForm && !editingExpId ? null : 'exp')}
                >
                  {showExpForm && !editingExpId ? t('closeDialog') : `+ ${t('emp.add')}`}
                </button>
              </div>
              <div className="timeline">
                {(profile.experiences || []).length === 0 && (
                  <p className="muted">{t('emp.noExperience')}</p>
                )}
                {(profile.experiences || []).map((x: any) => (
                  <div key={x.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-card">
                      <div className="timeline-card-head">
                        <div>
                          <strong>{x.title}</strong>
                          <div className="muted" style={{ fontSize: '0.85rem' }}>
                            {x.companyName}
                            {x.city ? ` | ${x.city.name}` : ''}
                          </div>
                        </div>
                        <div className="timeline-meta">
                          {x.isCurrent && <span className="badge match">{t('emp.current')}</span>}
                          <span className="badge">{formatDuration(t, x.startDate, x.endDate, x.isCurrent)}</span>
                          <button type="button" className="ghost" onClick={() => setOpenForm(`edit-exp:${x.id}`)}>{t('emp.edit')}</button>
                          <button type="button" className="ghost" onClick={() => removeItem('experiences', x.id)}>x</button>
                        </div>
                      </div>
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                        {new Date(x.startDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                        {' - '}
                        {x.isCurrent || !x.endDate
                          ? t('emp.present')
                          : new Date(x.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                      </div>
                      {x.description && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                            {expandedExp === x.id || x.description.length < 180
                              ? x.description
                              : `${x.description.slice(0, 180)}...`}
                          </p>
                          {x.description.length >= 180 && (
                            <button type="button" className="ghost" onClick={() => setExpandedExp(expandedExp === x.id ? null : x.id)}>
                              {expandedExp === x.id ? t('showLess') : t('viewMore')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {showExpForm && (
                <form
                  className="form-stack"
                  key={editingExpId || 'new-exp'}
                  onSubmit={saveExperience}
                  style={{ marginTop: '1rem' }}
                >
                  <p className="required-note">{t('requiredFieldsNote')}</p>
                  <div className="grid-2">
                    <label>
                      <LabelText required>{t('emp.positionTitle')}</LabelText>
                      <input name="title" required defaultValue={editingExp?.title || ''} />
                    </label>
                    <label>
                      <LabelText required>{t('company')}</LabelText>
                      <input name="companyName" required defaultValue={editingExp?.companyName || ''} />
                    </label>
                  </div>
                  <label>
                    <LabelText>{t('city')}</LabelText>
                    <select name="citySlug" defaultValue={editingExp?.city?.slug || ''}>
                      <option value="">-</option>
                      {cities.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <LabelText>{t('emp.description')}</LabelText>
                    <textarea name="description" rows={3} defaultValue={editingExp?.description || ''} />
                  </label>
                  <div className="grid-2">
                    <label>
                      <LabelText required>{t('emp.start')}</LabelText>
                      <input name="startDate" type="date" required defaultValue={dateInputValue(editingExp?.startDate)} />
                    </label>
                    <label>
                      <LabelText>{t('emp.end')}</LabelText>
                      <input name="endDate" type="date" defaultValue={dateInputValue(editingExp?.endDate)} />
                    </label>
                  </div>
                  <label className="check-row">
                    <input name="isCurrent" type="checkbox" defaultChecked={Boolean(editingExp?.isCurrent)} />
                    <LabelText optional={false}>{t('emp.currentlyWorkHere')}</LabelText>
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit">
                      {editingExpId ? t('emp.updateExperience') : t('emp.saveExperience')}
                    </button>
                    {editingExpId && (
                      <button type="button" className="secondary" onClick={() => setOpenForm(null)}>{t('cancel')}</button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="grid-2 profile-block">
              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>{t('education')}</h3>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setOpenForm(showEduForm && !editingEduId ? null : 'edu')}
                  >
                    {showEduForm && !editingEduId ? t('closeDialog') : `+ ${t('emp.add')}`}
                  </button>
                </div>
                <ul className="profile-list">
                  {(profile.educations || []).map((x: any) => (
                    <li key={x.id} className="profile-list-row profile-list-row--stack">
                      <div className="profile-list-main">
                        <strong>{x.school}</strong>
                        <div className="chips" style={{ marginTop: '0.4rem' }}>
                          {x.degree && (
                            <span className={`badge degree-${String(x.degree).toLowerCase()}`}>
                              {enumLabel('degree', x.degree)}
                            </span>
                          )}
                          {x.field && <span className="badge skill">{x.field}</span>}
                        </div>
                        {(x.startDate || x.endDate) && (
                          <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                            {x.startDate ? new Date(x.startDate).getFullYear() : '-'} -{' '}
                            {x.endDate ? new Date(x.endDate).getFullYear() : t('emp.present')}
                          </div>
                        )}
                      </div>
                      <div className="profile-list-actions">
                        <button type="button" className="ghost" onClick={() => setOpenForm(`edit-edu:${x.id}`)}>{t('emp.edit')}</button>
                        <button type="button" className="ghost" onClick={() => removeItem('educations', x.id)}>x</button>
                      </div>
                    </li>
                  ))}
                </ul>
                {!(profile.educations || []).length && <p className="muted">{t('emp.noEducation')}</p>}
                {showEduForm && (
                  <form
                    className="form-stack"
                    key={editingEduId || 'new-edu'}
                    onSubmit={saveEducation}
                    style={{ marginTop: '1rem' }}
                  >
                    <p className="required-note">{t('requiredFieldsNote')}</p>
                    <label>
                      <LabelText required>{t('emp.school')}</LabelText>
                      <input name="school" required defaultValue={editingEdu?.school || ''} />
                    </label>
                    <div className="grid-2">
                      <label>
                        <LabelText>{t('emp.degree')}</LabelText>
                        <select name="degree" defaultValue={editingEdu?.degree || ''}>
                          <option value="">-</option>
                          {['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'].map((d) => (
                            <option key={d} value={d}>{enumLabel('degree', d)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <LabelText>{t('emp.field')}</LabelText>
                        <input name="field" defaultValue={editingEdu?.field || ''} />
                      </label>
                    </div>
                    <div className="grid-2">
                      <label>
                        <LabelText>{t('emp.start')}</LabelText>
                        <input name="startDate" type="date" defaultValue={dateInputValue(editingEdu?.startDate)} />
                      </label>
                      <label>
                        <LabelText>{t('emp.end')}</LabelText>
                        <input name="endDate" type="date" defaultValue={dateInputValue(editingEdu?.endDate)} />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="submit">
                        {editingEduId ? t('emp.updateEducation') : t('emp.saveEducation')}
                      </button>
                      {editingEduId && (
                        <button type="button" className="secondary" onClick={() => setOpenForm(null)}>{t('cancel')}</button>
                      )}
                    </div>
                  </form>
                )}
              </div>

              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>{t('languages')}</h3>
                  <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'lang' ? null : 'lang')}>
                    {openForm === 'lang' ? t('closeDialog') : `+ ${t('emp.add')}`}
                  </button>
                </div>
                <ul className="profile-list">
                  {(profile.languages || []).map((x: any) => (
                    <li key={x.id} className="profile-list-row">
                      <div className="profile-list-main">
                        <strong className="profile-list-title">{x.language?.name}</strong>
                        <span className={`cefr cefr-${String(x.level || 'b1').toLowerCase()}`}>{x.level}</span>
                      </div>
                      <div className="profile-list-actions">
                        <select
                          aria-label={t('emp.levelFor').replace('{name}', x.language?.name)}
                          value={x.level || 'B1'}
                          onChange={(e) => updateLanguageLevel(x.id, e.target.value)}
                        >
                          {LANG_LEVELS.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                        <button type="button" className="ghost" onClick={() => removeItem('languages', x.id)}>
                          {t('emp.remove')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {!(profile.languages || []).length && <p className="muted">{t('emp.noLanguages')}</p>}
                {openForm === 'lang' && (
                  <div style={{ marginTop: '1rem' }}>
                    <p className="required-note">{t('requiredFieldsNote')}</p>
                    <LookupCombobox
                      kind="languages"
                      allowCreate
                      submitLabel={t('addLanguage')}
                      placeholder={t('languageSearchPlaceholder')}
                      defaultLevel="B1"
                      levelOptions={LANG_LEVELS.map((l) => ({
                        value: l,
                        label: l,
                      }))}
                      onPick={async (item) => {
                        await addLanguagePick(item);
                        setOpenForm(null);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="card profile-block">
              <div className="cv-section-head">
                <h3 style={{ margin: 0 }}>{t('certifications')}</h3>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setOpenForm(showCertForm && !editingCertId ? null : 'cert')}
                >
                  {showCertForm && !editingCertId ? t('closeDialog') : `+ ${t('emp.add')}`}
                </button>
              </div>
              <ul className="profile-list">
                {(profile.certifications || []).map((x: any) => (
                  <li key={x.id} className="profile-list-row profile-list-row--stack">
                    <div className="profile-list-main">
                      <strong>{x.name}</strong>
                      {x.issuer && <div className="muted" style={{ fontSize: '0.85rem' }}>{x.issuer}</div>}
                      {x.issuedAt && (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {t('emp.issued')} {new Date(x.issuedAt).toLocaleDateString()}
                        </div>
                      )}
                      {x.expiresAt && (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {t('emp.expires')} {new Date(x.expiresAt).toLocaleDateString()}
                        </div>
                      )}
                      {x.credentialUrl && (
                        <a href={x.credentialUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
                          {t('emp.viewCredential')} →
                        </a>
                      )}
                    </div>
                    <div className="profile-list-actions">
                      <button type="button" className="ghost" onClick={() => setOpenForm(`edit-cert:${x.id}`)}>{t('emp.edit')}</button>
                      <button type="button" className="ghost" onClick={() => removeItem('certifications', x.id)}>x</button>
                    </div>
                  </li>
                ))}
              </ul>
              {!(profile.certifications || []).length && <p className="muted">{t('emp.noCertifications')}</p>}
              {showCertForm && (
                <form
                  className="form-stack"
                  key={editingCertId || 'new-cert'}
                  onSubmit={saveCertification}
                  style={{ marginTop: '1rem' }}
                >
                  <p className="required-note">{t('requiredFieldsNote')}</p>
                  <label>
                    <LabelText required>{t('emp.name')}</LabelText>
                    <input name="name" required defaultValue={editingCert?.name || ''} />
                  </label>
                  <div className="grid-2">
                    <label>
                      <LabelText>{t('emp.issuer')}</LabelText>
                      <input name="issuer" defaultValue={editingCert?.issuer || ''} />
                    </label>
                    <label>
                      <LabelText>{t('emp.issuedAt')}</LabelText>
                      <input name="issuedAt" type="date" defaultValue={dateInputValue(editingCert?.issuedAt)} />
                    </label>
                  </div>
                  <label>
                    <LabelText>{t('emp.expiresAt')}</LabelText>
                    <input name="expiresAt" type="date" defaultValue={dateInputValue(editingCert?.expiresAt)} />
                  </label>
                  <label>
                    <LabelText>{t('emp.credentialUrl')}</LabelText>
                    <input name="credentialUrl" type="url" placeholder="https://..." defaultValue={editingCert?.credentialUrl || ''} />
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit">
                      {editingCertId ? t('emp.updateCertification') : t('emp.saveCertification')}
                    </button>
                    {editingCertId && (
                      <button type="button" className="secondary" onClick={() => setOpenForm(null)}>{t('cancel')}</button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="card profile-block">
              <div className="cv-section-head">
                <div>
                  <h3 style={{ margin: 0 }}>{t('resumes')}</h3>
                  <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                    {t('emp.resumesHint')}
                  </p>
                </div>
                <div className="chips" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="chip"
                    style={{ fontWeight: 600 }}
                    disabled={
                      addingResume ||
                      (profile.resumes || []).length >= MAX_RESUMES_PER_PROFILE
                    }
                    onClick={openCreateResume}
                  >
                    {`+ ${t('addResume')}`}
                  </button>
                  {(profile.resumes || []).length > 0 && (
                    <Link
                      href="/dashboard/employee/resume-builder"
                      className="chip"
                      style={{ fontWeight: 600 }}
                    >
                      {t('openResumeBuilder')}
                    </Link>
                  )}
                </div>
              </div>
              <ul className="profile-list">
                {(profile.resumes || []).map((r: any) => (
                  <li key={r.id} className="profile-list-row profile-list-row--stack">
                    <div className="profile-list-main">
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' }}>
                        <strong>{r.title}</strong>
                        {r.isPrimary && <span className="badge match">{t('emp.primary')}</span>}
                        {(r.hasFile || r.fileKey) && (
                          <span className="badge skill">{t('emp.pdfAttached')}</span>
                        )}
                      </div>
                      {r.targetJobTitle?.name && (
                        <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
                          {t('resumeTargetRole')}: {r.targetJobTitle.name}
                        </p>
                      )}
                      <div className="chips" style={{ marginTop: '0.65rem' }}>
                        {(r.hasFile || r.fileKey) ? (
                          <button type="button" className="chip" onClick={() => downloadResume(r.id)}>
                            {t('viewPdf')}
                          </button>
                        ) : (
                          <Link
                            href={`/dashboard/employee/resume-builder?resumeId=${r.id}`}
                            className="chip"
                          >
                            {t('previewResume')}
                          </Link>
                        )}
                        <Link
                          href={`/dashboard/employee/resume-builder?resumeId=${r.id}`}
                          className="chip"
                        >
                          {r.builderMeta?.lastExportAt ? t('editInBuilder') : t('openInBuilder')}
                        </Link>
                        {!r.isPrimary && (
                          <button type="button" className="chip" onClick={() => setPrimaryResume(r.id)}>
                            {t('emp.setPrimary')}
                          </button>
                        )}
                        <label className="chip" style={{ cursor: 'pointer' }}>
                          {(r.hasFile || r.fileKey) ? t('replaceFile') : t('attachPdf')}
                          <input
                            type="file"
                            accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                            hidden
                            disabled={uploading}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) attachFileToResume(r.id, f);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="profile-list-actions">
                      <button
                        type="button"
                        className="ghost"
                        aria-label={t('deleteCvTitle')}
                        onClick={() => removeItem('resumes', r.id)}
                      >
                        x
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {!(profile.resumes || []).length && (
                <p className="muted">
                  {t('emp.noResumesBefore')} <strong>+ {t('addResume')}</strong>{' '}
                  {t('emp.noResumesAfter')}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function EmployeeDashboard() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <EmployeeDashboardInner />
    </Suspense>
  );
}
