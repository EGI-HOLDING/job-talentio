"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  defaultPhoneCountry,
  phoneDraftFromE164,
  validatePhoneDraft,
  type EmployeeOnboardingInput,
  type PhoneDraft,
} from "@job-talentio/shared";
import { api, getSession, saveSession, type AuthSession } from "@/lib/api";
import { safeAuthNext } from "@/lib/authReturn";
import { useRouter } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { useOnboardingText } from "@/lib/i18n/onboarding";
import { WorkspaceLoading } from "@/components/employee/WorkspacePrimitives";
import { PhoneNumberField, phoneErrorText } from "@/components/ui/PhoneNumberField";
import { CV_ACCEPT, cvFileError } from "@/components/profile/types";
import {
  RoleInput,
  CountryPicker,
  SalaryFields,
  type Country,
  type SalaryValue,
} from "./PreferenceFields";
import s from "./Onboarding.module.css";

type Form = EmployeeOnboardingInput &
  SalaryValue & {
    desiredPositions: string[];
    preferredCountryIds: string[];
    fullName: string;
    visibility: "PUBLIC" | "TO_REGISTERED_RECRUITERS" | "PRIVATE";
  };
type State = {
  status: "IN_PROGRESS" | "NOT_REQUIRED" | "COMPLETED";
  step: number;
  draft: EmployeeOnboardingInput;
  profile: {
    user: { fullName: string };
    resumes: { id: string; title: string;isPrimary:boolean;hasFile:boolean }[];
    desiredPositions: string[];
    desiredRoles?:Array<{jobTitleId:string;jobTitle:{name:string}}>;
    preferredCountries: Country[];
    residenceCountryId: string | null;
    desiredSalaryMin: number | null;
    desiredSalaryCurrency: string;
    desiredSalaryPeriod: SalaryValue["desiredSalaryPeriod"];
    salaryNegotiable: boolean;
    visibility: Form["visibility"];
    noExperience: boolean;
    phone: string | null;
    residenceCountry?: Country | null;
  };
};
function Badge({ step }: { step: number }) {
  return (
    <div className={s.badge} aria-hidden="true">
      <svg viewBox="0 0 32 32">
        {step === 2 ? (
          <>
            <circle cx="16" cy="16" r="12" />
            <ellipse cx="16" cy="16" rx="5" ry="12" />
            <path d="M4 16h24M7 9h18M7 23h18" />
          </>
        ) : step === 3 ? (
          <>
            <ellipse cx="20" cy="8" rx="8" ry="4" />
            <path d="M12 8v7c0 5 16 5 16 0V8M15 20c6 3 13 0 13-3" />
            <ellipse cx="10" cy="18" rx="8" ry="4" />
            <path d="M2 18v7c0 5 16 5 16 0v-7M2 22c0 5 16 5 16 0" />
          </>
        ) : step === 4 ? (
          <>
            <circle cx="16" cy="9" r="5" />
            <path d="M6 28v-4c0-11 20-11 20 0v4Z" />
          </>
        ) : step === 5 ? (
          <><path d="M8 3h11l6 6v20H8zM19 3v7h6M12 16h9M12 21h9" /></>
        ) : (
          <>
            <rect x="3" y="9" width="26" height="20" rx="3" />
            <path d="M11 9V5h10v4M3 17h26M14 16v5h4v-5" />
          </>
        )}
      </svg>
    </div>
  );
}
export function EmployeeOnboarding() {
  const router = useRouter(),
    params = useSearchParams(),
    t = useOnboardingText(),
    { t: appText } = useI18n();
  const destination =
    safeAuthNext(params.get("next")) || "/jobs?mode=for-you";
  const [form, setForm] = useState<Form | null>(null),
    [step, setStep] = useState(1),
    [countries, setCountries] = useState<Country[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [phoneTouched, setPhoneTouched] = useState(false),
    [phoneServerError, setPhoneServerError] = useState<string | undefined>(),
    [saveState, setSaveState] = useState(""),
    [loadKey, setLoadKey] = useState(0);
  const [uploading, setUploading] = useState(false),
    [fileName, setFileName] = useState("");
  const uploadPending=useRef(false),uploadEpoch=useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve()),
    stopped = useRef(false),
    fileInput = useRef<HTMLInputElement>(null),
    saveVersion = useRef(0),
    loaded = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    loaded.current = false;
    stopped.current = false;
    Promise.all([
      api<State>("/profiles/me/onboarding", { signal: abort.signal }),
      api<Country[]>("/meta/countries", { signal: abort.signal }),
    ])
      .then(([state, options]) => {
        if (state.status !== "IN_PROGRESS") {
          router.replace(destination);
          return;
        }
        const p = state.profile,
          draft = state.draft || {};
        const marketPhoneCountry = process.env.NEXT_PUBLIC_DEFAULT_LOCALE === "id" ? "ID" : "UZ";
        const savedPhoneDraft = draft.phoneDraft as PhoneDraft | undefined;
        const phoneDraft = savedPhoneDraft
          ? {
              ...savedPhoneDraft,
              country: defaultPhoneCountry(
                savedPhoneDraft.country,
                p.residenceCountry?.iso2 || marketPhoneCountry,
              ),
            }
          : phoneDraftFromE164(
              p.phone,
              p.residenceCountry?.iso2,
              marketPhoneCountry,
            );
        const initialPhone = validatePhoneDraft(phoneDraft);
        const selectedCv=p.resumes.find(r=>r.id===draft.resumeId&&r.hasFile)||p.resumes.find(r=>r.isPrimary&&r.hasFile);
        setFileName(selectedCv?.title||'');
        setCountries(options);
        setStep(state.step);
        setForm({
          desiredPositions: p.desiredRoles?.length?p.desiredRoles.map(r=>r.jobTitle.name):p.desiredPositions || [],
          ...(process.env.NEXT_PUBLIC_EMPLOYEE_INTENT_V3_PREFERENCES==='true'?{desiredJobTitleIds:p.desiredRoles?.map(r=>r.jobTitleId)||[]} : {}),
          preferredCountryIds: p.preferredCountries.map((c) => c.id),
          fullName: p.user.fullName,
          residenceCountryId: p.residenceCountryId,
          desiredSalaryMin: p.desiredSalaryMin,
          desiredSalaryCurrency:
            p.desiredSalaryMin == null ? "USD" : p.desiredSalaryCurrency,
          desiredSalaryPeriod:
            p.desiredSalaryMin == null ? "MONTHLY" : p.desiredSalaryPeriod,
          salaryNegotiable: p.salaryNegotiable,
          visibility: p.visibility,
          noExperience: p.noExperience,
          ...draft,
          resumeId:selectedCv?.id,
          review:null,reviewState:null,manualExperiences:[],
          phoneDraft,
          phone: initialPhone.ok ? initialPhone.phone : undefined,
        });
        setPhoneTouched(false);
        setPhoneServerError(undefined);
        loaded.current = true;
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      stopped.current = true;
      ++uploadEpoch.current;
    };
  }, [loadKey, router, destination]);
  function persist(value: Form, targetStep: number) {
    const version = ++saveVersion.current;
    setSaveState("saving");
    const payload = {
      ...value,
      step: targetStep,
      // Persist the editable draft independently of strict import validation.
      review: null,
    };
    const task = queue.current
      .catch(() => {})
      .then(() =>
        api("/profiles/me/onboarding", {
          method: "PATCH",
          body: JSON.stringify(payload),
        }),
      );
    queue.current = task;
    void task.then(
      () => {
        if (version === saveVersion.current) setSaveState("saved");
      },
      (e) => {
        if (version === saveVersion.current) {
          setSaveState("");
          const message = e instanceof Error ? e.message : String(e);
          if (/^PHONE_(REQUIRED|INVALID|COUNTRY_CODE_REPEATED|COUNTRY_CODE_MISMATCH|NATIONAL_PREFIX|DUPLICATE)$/.test(message)) {
            setPhoneTouched(true);
            setPhoneServerError(message);
            setError("");
          } else setError(phoneErrorText(message, t));
        }
      },
    );
    return task;
  }
  // Queue writes in order. Every edit is sent immediately, including the selected CV file.
  useEffect(() => {
    if (form && loaded.current && !stopped.current) void persist(form, step);
  }, [form, step]); // eslint-disable-line react-hooks/exhaustive-deps
  function update(value: Partial<Form>) {
    setError("");
    if (value.phoneDraft !== undefined) setPhoneServerError(undefined);
    setForm((prev) => (prev ? { ...prev, ...value } : prev));
  }
  async function navigate(targetStep: number, skipSalary = false) {
    if (!form || busy) return;
    let normalizedPhone = form.phone;
    if (targetStep > step) {
      if (step === 1 && !(process.env.NEXT_PUBLIC_EMPLOYEE_INTENT_V3_PREFERENCES==='true'?form.desiredJobTitleIds?.length:form.desiredPositions.length)) {
        setError(t("requiredRoles"));
        return;
      }
      if (step === 2 && !form.preferredCountryIds.length) {
        setError(t("requiredCountry"));
        return;
      }
      if (
        step === 3 &&
        !skipSalary &&
        form.desiredSalaryMin !== null &&
        (!Number.isFinite(form.desiredSalaryMin) ||
          form.desiredSalaryMin <= 0 ||
          Math.abs(
            form.desiredSalaryMin * 100 -
              Math.round(form.desiredSalaryMin * 100),
          ) > 0.001)
      ) {
        setError(t("salaryError"));
        return;
      }
      if (
        step === 4 &&
        (form.fullName.trim().length < 2 || !form.residenceCountryId)
      ) {
        setError(t("requiredIdentity"));
        return;
      }
      if (step === 4) {
        const phone = validatePhoneDraft(form.phoneDraft || { country: "", nationalNumber: "" });
        if (!phone.ok) {
          setPhoneTouched(true);
          setPhoneServerError(undefined);
          return;
        }
        normalizedPhone = phone.phone;
      }
    }
    setBusy(true);
    setError("");
    try {
      const next = {
        ...(skipSalary
          ? { ...form, desiredSalaryMin: null, salaryNegotiable: false }
          : form),
        ...(step === 4 && targetStep > step ? { phone: normalizedPhone } : {}),
      };
      await persist(next, targetStep);
      if (skipSalary || step === 4) setForm(next);
      setStep(targetStep);
      document
        .querySelector("[data-onboarding-heading]")
        ?.scrollIntoView({ block: "start" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/^PHONE_(REQUIRED|INVALID|COUNTRY_CODE_REPEATED|COUNTRY_CODE_MISMATCH|NATIONAL_PREFIX|DUPLICATE)$/.test(message)) {
        setPhoneTouched(true);
        setPhoneServerError(message);
        setError("");
      } else setError(phoneErrorText(message, t));
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!form || busy || uploading) return;
    if(!form.resumeId){setError(appText('cv.required'));return;}
    const review=null;
    const phone = validatePhoneDraft(form.phoneDraft || { country: "", nationalNumber: "" });
    if (!phone.ok) {
      setPhoneTouched(true);
      setPhoneServerError(undefined);
      setStep(4);
      return;
    }
    setBusy(true);
    setError("");
    stopped.current = true;
    try {
      await queue.current.catch(() => {});
      await api("/profiles/me/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          phone: phone.phone,
          step: 5,
          review,
          reviewState:null,manualExperiences:[],
        }),
      });
      const session = await api<AuthSession>("/auth/me");
      saveSession(session);
      router.replace(destination);
    } catch (e) {
      stopped.current = false;
      const message = e instanceof Error ? e.message : String(e);
      if (/^PHONE_(REQUIRED|INVALID|COUNTRY_CODE_REPEATED|COUNTRY_CODE_MISMATCH|NATIONAL_PREFIX|DUPLICATE)$/.test(message)) {
        setPhoneTouched(true);
        setPhoneServerError(message);
        setStep(4);
        setError("");
      } else setError(phoneErrorText(message, t));
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file || uploadPending.current) return;
    const validation = cvFileError(file, appText);
    if (validation) {
      setError(validation);
      return;
    }
    uploadPending.current=true;
    const epoch=++uploadEpoch.current,actor=getSession()?.user.id;
    setUploading(true);
    setError("");
    try {
      // Keep the selected file until its replacement has been stored successfully.
      const body = new FormData();
      body.append("file", file);
      body.append("parse", "true");
      body.append("title", file.name.slice(0,160));
      const resume = await api<{ id: string }>(form?.resumeId?`/profiles/me/resumes/${form.resumeId}/file`:"/profiles/me/resumes/upload", {
        method: "POST",
        body,
      });
      if(epoch!==uploadEpoch.current||getSession()?.user.id!==actor)return;
      setFileName(file.name);
      update({
        resumeId: resume.id,
        resumeGeneration: undefined,
        reviewState: null,
        review: null,
      });
    } catch (e) {
      if(epoch===uploadEpoch.current&&getSession()?.user.id===actor)setError(e instanceof Error ? e.message : String(e));
    } finally {
      uploadPending.current=false;
      if(epoch===uploadEpoch.current)setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  if (!form)
    return error ? (
      <div className={s.page}>
        <p role="alert" className={s.error}>
          {error}
        </p>
        <button
          className={s.secondary}
          onClick={() => setLoadKey((v) => v + 1)}
        >
          {t("retry")}
        </button>
      </div>
    ) : (
      <WorkspaceLoading />
    );
  const titles = [
    t("positions"),
    t("countryTitle"),
    t("salaryTitle"),
    t("identity"),
    appText('cv.upload'),
  ];
  const hints = [
    t("positionsHint"),
    t("countryHint"),
    t("salaryHint"),
    t("identityHint"),
    appText('cv.uploadHint'),
  ];
  return (
    <section className={s.page}>
      <div className={s.progressLabel}>
        {t("step").replace("{n}", String(step))}
      </div>
      <div
        className={s.progress}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={step}
        aria-label={t("step").replace("{n}", String(step))}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= step ? s.done : undefined} />
        ))}
      </div>
      <div className={s.body}>
        <Badge step={step} />
        <h1 data-onboarding-heading tabIndex={-1}>
          {titles[step - 1]}
        </h1>
        <p className={s.hint}>{hints[step - 1]}</p>
        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}
        <fieldset
          disabled={busy || uploading}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          {step === 1 && (
            <RoleInput
              value={form.desiredPositions}
              selectedIds={form.desiredJobTitleIds}
              onChange={(v,ids) => update({ desiredPositions: v,...(ids?{desiredJobTitleIds:ids}:{}) })}
            />
          )}
          {step === 2 && (
            <CountryPicker
              countries={countries}
              value={form.preferredCountryIds}
              onChange={(v) => update({ preferredCountryIds: v })}
            />
          )}
          {step === 3 && (
            <SalaryFields
              value={form}
              countries={countries}
              onChange={update}
            />
          )}
          {step === 4 && (
            <>
              <div className={s.fields}>
                <label>
                  {t("fullName")} *
                  <input
                    autoComplete="name"
                    maxLength={200}
                    value={form.fullName}
                    onChange={(e) => update({ fullName: e.target.value })}
                  />
                </label>
                <PhoneNumberField
                  value={form.phoneDraft || { country: "", nationalNumber: "" }}
                  onChange={(phoneDraft) => {
                    const result = validatePhoneDraft(phoneDraft);
                    update({ phoneDraft, phone: result.ok ? result.phone : undefined });
                  }}
                  label={t("phone")}
                  hint={t("phoneHint")}
                  required
                  errorCode={phoneServerError || (phoneTouched && !validatePhoneDraft(form.phoneDraft || { country: "", nationalNumber: "" }).ok
                    ? (validatePhoneDraft(form.phoneDraft || { country: "", nationalNumber: "" }) as { ok: false; error: string }).error
                    : undefined)}
                />
              </div>
              <CountryPicker
                countries={countries}
                value={form.residenceCountryId ? [form.residenceCountryId] : []}
                single
                label={t("residence")}
                onChange={(v) => update({ residenceCountryId: v[0] || null })}
              />
              <div className={s.fields}>
                <span>{t("visibility")}</span>
                {(
                  ["PUBLIC", "TO_REGISTERED_RECRUITERS", "PRIVATE"] as const
                ).map((v) => (
                  <label key={v} className={s.visibility}>
                    <input
                      type="radio"
                      name="visibility"
                      checked={form.visibility === v}
                      onChange={() => update({ visibility: v })}
                    />
                    <span>
                      <strong>{t(v)}</strong>
                      <small>{t(`${v}Hint`)}</small>
                    </span>
                  </label>
                ))}
                <small>{t("changeLater")}</small>
              </div>
            </>
          )}
          {step === 5 && <>
            <input ref={fileInput} className={s.srOnly} type="file" accept={CV_ACCEPT} aria-label={t('chooseFile')} onChange={event=>void upload(event.target.files?.[0])} />
            <div className={s.upload} aria-busy={uploading} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!uploading)void upload(event.dataTransfer.files[0]);}}>
              <Badge step={5} /><h2>{form.resumeId?fileName||'CV':appText('cv.upload')}</h2>
              <p>{form.resumeId?appText('cv.saved'):appText('cv.noManual')}</p>
              <button className={s.secondary} type="button" disabled={uploading} onClick={()=>fileInput.current?.click()}>{t(form.resumeId?'changeCv':'chooseFile')}</button>
              <p>{t('fileHint')}</p>
              {uploading&&<div role="status"><progress aria-label={appText('cv.uploading')} /><p>{appText('cv.uploading')}</p></div>}
            </div>
          </>}
        </fieldset>
        <div className={s.status} role="status" aria-live="polite">
          {saveState === "saving"
            ? t("saving")
            : saveState === "saved"
              ? t("saved")
              : ""}
        </div>
      </div>
      <footer className={s.footer}>
        {step > 1 && (
          <button
            type="button"
            className={s.secondary}
            disabled={busy || uploading}
            onClick={() => void navigate(step - 1)}
          >
            ← {t("back")}
          </button>
        )}
        <div className={s.footerRight}>
          {step === 3 && (
            <button
              className={s.textButton}
              disabled={busy || uploading}
              type="button"
              onClick={() =>
                void navigate(4, true)
              }
            >
              {t("skip")}
            </button>
          )}
          <button
            type="button"
            className={s.primary}
            disabled={busy || uploading || (step === 5 && !form.resumeId)}
            onClick={() => (step < 5 ? void navigate(step + 1) : void finish())}
          >
            {busy ? t("saving") : t(step === 5 ? "finish" : "next")} →
          </button>
        </div>
      </footer>
    </section>
  );
}
