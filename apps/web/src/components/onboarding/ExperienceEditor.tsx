"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EmployeeOnboardingInput } from "@job-talentio/shared";
import { useOnboardingText } from "@/lib/i18n/onboarding";
import { CountryPicker, type Country } from "./PreferenceFields";
import { JobTitleInput } from "@/components/ui/JobTitleInput";
import s from "./Onboarding.module.css";
export type ExperienceDraft = NonNullable<
  EmployeeOnboardingInput["manualExperiences"]
>[number];
export function ExperienceEditor({
  initial,
  countries,
  onSave,
  onClose,
  requireStart = true,
}: {
  initial?: ExperienceDraft;
  countries: Country[];
  onSave: (value: ExperienceDraft) => void | Promise<void>;
  onClose: () => void;
  requireStart?: boolean;
}) {
  const t = useOnboardingText(),
    ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState(Boolean(initial?.isCurrent)),
    [country, setCountry] = useState(
      initial?.countryId ? [initial.countryId] : [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget),
      text = (key: string) => String(fd.get(key) || "").trim();
    if (
      text("endDate") &&
      text("startDate") &&
      !current &&
      text("endDate") < text("startDate")
    ) {
      setError(t("dateError"));
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await onSave({
        title: text("title"),
        companyName: text("companyName"),
        startDate: text("startDate") || null,
        endDate: current ? null : text("endDate") || null,
        isCurrent: current,
        description: text("description"),
        ...(country[0] ? { countryId: country[0] } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="experience-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className={s.cardTop}>
        <h2 id="experience-title">{t(initial ? "edit" : "addExperience")}</h2>
        <button
          className={s.textButton}
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t("cancel")}
        >
          ×
        </button>
      </div>
      <form onSubmit={submit}>
        <div className={s.dialogBody}>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.fields}>
            <label>
              {t("position")} *
              <JobTitleInput
                name="title"
                defaultValue={initial?.title}
                required
                minLength={2}
                normalizeSeniority={false}
                autoFocus
              />
            </label>
            <label>
              {t("company")} *
              <input
                name="companyName"
                defaultValue={initial?.companyName}
                required
                maxLength={160}
              />
            </label>
            <div className={s.twoColumns}>
              <label>
                {t("start")}
                {requireStart ? " *" : ""}
                <input
                  type="date"
                  name="startDate"
                  required={requireStart}
                  defaultValue={initial?.startDate?.slice(0, 10) || ""}
                />
              </label>
              <label>
                {t("end")}
                <input
                  type="date"
                  name="endDate"
                  disabled={current}
                  defaultValue={initial?.endDate?.slice(0, 10) || ""}
                />
              </label>
            </div>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={current}
                onChange={(e) => setCurrent(e.target.checked)}
              />
              {t("current")}
            </label>
          </div>
          <CountryPicker
            single
            countries={countries}
            value={country}
            onChange={setCountry}
            label={t("country")}
          />
          <div className={s.fields}>
            <label>
              {t("description")} ({t("optional")})
              <textarea
                name="description"
                rows={4}
                maxLength={5000}
                defaultValue={initial?.description || ""}
              />
            </label>
          </div>
        </div>
        <footer className={s.footer}>
          <button type="button" className={s.secondary} onClick={onClose}>
            {t("cancel")}
          </button>
          <button className={s.primary} type="submit" disabled={busy}>
            {t(busy ? "saving" : "saveExperience")} →
          </button>
        </footer>
      </form>
    </dialog>
  );
}
