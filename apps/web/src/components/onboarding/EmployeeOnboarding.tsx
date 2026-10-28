"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { EmployeeOnboardingInput } from "@job-talentio/shared";
import { api, saveSession, type AuthSession } from "@/lib/api";
import { safeAuthNext } from "@/lib/authReturn";
import { useRouter } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { useOnboardingText } from "@/lib/i18n/onboarding";
import { WorkspaceLoading } from "@/components/employee/WorkspacePrimitives";
import { CV_ACCEPT, cvFileError } from "@/components/profile/types";
import {
  RoleInput,
  CountryPicker,
  SalaryFields,
  type Country,
  type SalaryValue,
} from "./PreferenceFields";
import { ExperienceEditor, type ExperienceDraft } from "./ExperienceEditor";
import { CvReview, createReview, selectedReview, reviewError } from "./CvReview";
import {
  waitForResumeParse,
  type ResumeParseStatusResponse,
} from "@/lib/cvParse";
import type { ParsedCv } from "@/components/CvReviewModal";
import s from "./Onboarding.module.css";

type Form = EmployeeOnboardingInput &
  SalaryValue & {
    desiredPositions: string[];
    preferredCountryIds: string[];
    fullName: string;
    visibility: "PUBLIC" | "TO_REGISTERED_RECRUITERS" | "PRIVATE";
    manualExperiences: ExperienceDraft[];
  };
type State = {
  status: "IN_PROGRESS" | "NOT_REQUIRED" | "COMPLETED";
  step: number;
  draft: EmployeeOnboardingInput;
  profile: {
    user: { fullName: string };
    resumes: { id: string; title: string }[];
    desiredPositions: string[];
    preferredCountries: Country[];
    residenceCountryId: string | null;
    desiredSalaryMin: number | null;
    desiredSalaryCurrency: string;
    desiredSalaryPeriod: SalaryValue["desiredSalaryPeriod"];
    salaryNegotiable: boolean;
    visibility: Form["visibility"];
    noExperience: boolean;
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
    [saveState, setSaveState] = useState(""),
    [loadKey, setLoadKey] = useState(0);
  const [editor, setEditor] = useState<number | "new" | null>(null),
    [parse, setParse] = useState<ResumeParseStatusResponse | null>(null),
    [pollKey, setPollKey] = useState(0),
    [uploading, setUploading] = useState(false),
    [fileName, setFileName] = useState("");
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
        setFileName(
          p.resumes.find((r) => r.id === draft.resumeId)?.title || "",
        );
        setCountries(options);
        setStep(state.step);
        setForm({
          desiredPositions: p.desiredPositions || [],
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
          manualExperiences: [],
          ...draft,
        });
        loaded.current = true;
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      stopped.current = true;
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
          setError(e.message);
        }
      },
    );
    return task;
  }
  // Queue writes in order. Every edit is sent immediately, including the CV review.
  useEffect(() => {
    if (form && loaded.current && !stopped.current) void persist(form, step);
  }, [form, step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!form?.resumeId) return;
    const abort = new AbortController(),
      resumeId = form.resumeId;
    setParse({ id: resumeId, parseStatus: "PROCESSING" });
    waitForResumeParse(resumeId, { signal: abort.signal, timeoutMs: 180000 })
      .then((result) => {
        if (abort.signal.aborted) return;
        setParse(result);
        setForm((prev) => {
          if (!prev || prev.resumeId !== resumeId) return prev;
          if (result.parseStatus === "READY" && result.parsedData)
            return {
              ...prev,
              resumeGeneration: result.parseGeneration,
              reviewState:
                prev.reviewState &&
                prev.resumeGeneration === result.parseGeneration
                  ? prev.reviewState
                  : createReview(result.parsedData as ParsedCv),
            };
          return prev;
        });
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setParse({
            id: resumeId,
            parseStatus: "FAILED",
            parseError: e.message,
          });
        }
      });
    return () => abort.abort();
  }, [form?.resumeId, pollKey]);
  function update(value: Partial<Form>) {
    setError("");
    setForm((prev) => (prev ? { ...prev, ...value } : prev));
  }
  async function navigate(targetStep: number, skipSalary = false) {
    if (!form || busy) return;
    if (targetStep > step) {
      if (step === 1 && !form.desiredPositions.length) {
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
    }
    setBusy(true);
    setError("");
    try {
      const next = skipSalary
        ? { ...form, desiredSalaryMin: null, salaryNegotiable: false }
        : form;
      await persist(next, targetStep);
      if (skipSalary) setForm(next);
      setStep(targetStep);
      document
        .querySelector("[data-onboarding-heading]")
        ?.scrollIntoView({ block: "start" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function finish(withoutImport = false) {
    if (!form || busy || uploading) return;
    const review = !withoutImport && form.reviewState ? selectedReview(form.reviewState, Boolean(form.noExperience)) : null;
    const invalidReview = review && reviewError(review);
    if (invalidReview) { setError(t(invalidReview)); return; }
    setBusy(true);
    setError("");
    stopped.current = true;
    try {
      await queue.current.catch(() => {});
      await api("/profiles/me/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          step: 5,
          review,
          reviewState: withoutImport ? null : form.reviewState,
        }),
      });
      const session = await api<AuthSession>("/auth/me");
      saveSession(session);
      router.replace(destination);
    } catch (e) {
      stopped.current = false;
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file || uploading) return;
    const validation = cvFileError(file, appText);
    if (validation) {
      setError(validation);
      return;
    }
    setUploading(true);
    setError("");
    try {
      // Keep the previous reviewed CV until the replacement upload succeeds.
      const body = new FormData();
      body.append("file", file);
      body.append("parse", "true");
      body.append("title", file.name);
      const resume = await api<{ id: string }>("/profiles/me/resumes/upload", {
        method: "POST",
        body,
      });
      setFileName(file.name);
      update({
        resumeId: resume.id,
        resumeGeneration: undefined,
        reviewState: null,
        review: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function retry() {
    if (!form?.resumeId) return;
    setError("");
    try {
      await api(`/profiles/me/resumes/${form.resumeId}/parse`, {
        method: "POST",
      });
      setPollKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    form.reviewState ? t("reviewTitle") : t("experience"),
  ];
  const hints = [
    t("positionsHint"),
    t("countryHint"),
    t("salaryHint"),
    t("identityHint"),
    t("experienceHint"),
  ];
  const parsing =
    parse?.parseStatus === "PROCESSING" || parse?.parseStatus === "PENDING";
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
              onChange={(v) => update({ desiredPositions: v })}
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
          {step === 5 && (
            <>
              <input
                ref={fileInput}
                className={s.srOnly}
                type="file"
                accept={CV_ACCEPT}
                aria-label={t("chooseFile")}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
              {form.resumeId && (
                <div className={`${s.card} ${s.fileCard}`}>
                  <div>
                    <strong>{fileName || "CV"}</strong>
                    <p>{t("uploaded")}</p>
                  </div>
                  <button
                    type="button"
                    className={s.textButton}
                    onClick={() => fileInput.current?.click()}
                  >
                    {t("changeCv")}
                  </button>
                </div>
              )}
              {uploading && (
                <p className={s.success} role="status">
                  {t("reading")}
                </p>
              )}
              {parsing && (
                <div className={s.success} role="status">
                  {t(parse?.parseStatus === "PENDING" ? "pending" : "reading")}
                  <button
                    type="button"
                    className={s.textButton}
                    onClick={() => void retry()}
                  >
                    {t("retry")}
                  </button>
                </div>
              )}
              {parse?.parseStatus === "FAILED" && (
                <div className={s.error} role="alert">
                  <p>{t("parseFailed")}</p>
                  {parse.parseError && <p>{parse.parseError}</p>}
                  <button
                    type="button"
                    className={s.secondary}
                    onClick={() => void retry()}
                  >
                    {t("retry")}
                  </button>
                </div>
              )}
              {form.reviewState && parse?.parseStatus === "READY" && (
                <CvReview
                  value={form.reviewState}
                  countries={countries}
                  noExperience={Boolean(form.noExperience)}
                  onChange={(v) => update({ reviewState: v })}
                />
              )}
              {!form.noExperience && (
                <>
                  {form.manualExperiences.map((exp, i) => (
                    <article className={s.card} key={i}>
                      <div className={s.cardTop}>
                        <strong>{exp.title}</strong>
                        <div>
                          <button
                            type="button"
                            className={s.textButton}
                            onClick={() => setEditor(i)}
                          >
                            {t("edit")}
                          </button>
                          <button
                            type="button"
                            className={s.textButton}
                            onClick={() =>
                              update({
                                manualExperiences:
                                  form.manualExperiences.filter(
                                    (_, j) => j !== i,
                                  ),
                              })
                            }
                          >
                            {t("remove")}
                          </button>
                        </div>
                      </div>
                      <p>
                        {exp.companyName} · {exp.startDate} –{" "}
                        {exp.isCurrent ? t("current") : exp.endDate || "—"}
                      </p>
                    </article>
                  ))}
                  <div className={s.empty}>
                    {!form.manualExperiences.length && !form.reviewState && (
                      <>
                        <Badge step={5} />
                        <p>{t("emptyExperience")}</p>
                      </>
                    )}
                    <button
                      type="button"
                      className={s.secondary}
                      disabled={form.manualExperiences.length >= 20}
                      onClick={() => setEditor("new")}
                    >
                      + {t("addExperience")}
                    </button>
                  </div>
                </>
              )}
              {!form.resumeId && (
                <>
                  <div className={s.divider}>{t("or")}</div>
                  <div
                    className={s.upload}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void upload(e.dataTransfer.files[0]);
                    }}
                  >
                    <Badge step={5} />
                    <h2>{t("upload")}</h2>
                    <p>{t("uploadHint")}</p>
                    <button
                      className={s.secondary}
                      type="button"
                      onClick={() => fileInput.current?.click()}
                    >
                      {t("chooseFile")}
                    </button>
                    <p>
                      {t("fileHint")}
                      <br />
                      {t("reviewHint")}
                    </p>
                  </div>
                </>
              )}
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={Boolean(form.noExperience)}
                  onChange={(e) => update({ noExperience: e.target.checked })}
                />
                {t("noExperience")}
              </label>
            </>
          )}
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
          {(step === 3 || step === 5) && (
            <button
              className={s.textButton}
              disabled={busy || uploading}
              type="button"
              onClick={() =>
                step === 3 ? void navigate(4, true) : void finish(true)
              }
            >
              {t(step === 5 && parsing ? "finishWithoutImport" : "skip")}
            </button>
          )}
          <button
            type="button"
            className={s.primary}
            disabled={busy || uploading || (step === 5 && Boolean(parsing))}
            onClick={() => (step < 5 ? void navigate(step + 1) : void finish())}
          >
            {busy ? t("saving") : t(step === 5 ? "finish" : "next")} →
          </button>
        </div>
      </footer>
      {editor !== null && (
        <ExperienceEditor
          initial={
            typeof editor === "number"
              ? form.manualExperiences[editor]
              : undefined
          }
          countries={countries}
          onClose={() => setEditor(null)}
          onSave={async (exp) => {
            const next = {
              ...form,
              manualExperiences:
                editor === "new"
                  ? [...form.manualExperiences, exp]
                  : form.manualExperiences.map((v, i) =>
                      i === editor ? exp : v,
                    ),
            };
            await persist(next, step);
            setForm(next);
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}
