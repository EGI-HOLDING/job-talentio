"use client";
import { useState } from "react";
import type { OnboardingReview, ResumeImportInput } from "@job-talentio/shared";
import { resumeImportSchema, resumeImportExperienceSchema } from "@job-talentio/shared";
import type { ParsedCv } from "@/components/CvReviewModal";
import { useOnboardingText } from "@/lib/i18n/onboarding";
import { useEnumLabel } from "@/lib/i18n";
import { ExperienceEditor } from "./ExperienceEditor";
import type { Country } from "./PreferenceFields";
import s from "./Onboarding.module.css";
export function completeExperience(experience: ResumeImportInput['experiences'][number]): boolean {
  return resumeImportExperienceSchema.safeParse(experience).success && Boolean(experience.startDate) &&
    (Boolean(experience.isCurrent) || !experience.endDate || experience.endDate >= experience.startDate!);
}
export function reviewError(review: ResumeImportInput): 'missingExperience' | 'reviewRequiredData' | null {
  if (review.experiences.some(experience => !completeExperience(experience))) return 'missingExperience';
  if (review.languages.some(language => !language.level)) return 'reviewRequiredData';
  return resumeImportSchema.safeParse(review).success ? null : 'reviewRequiredData';
}
export function createReview(parsed: ParsedCv): OnboardingReview {
  const degrees = ["HIGH_SCHOOL", "VOCATIONAL", "BACHELOR", "MASTER", "PHD"],
    levels = ["A1", "A2", "B1", "B2", "C1", "C2", "NATIVE"];
  const data: ResumeImportInput = {
    replaceExisting: false,
    headline: parsed.headline || "",
    summary: parsed.summary || "",
    skills: (parsed.skillNames || []).slice(0, 50),
    experiences: (parsed.experiences || []).slice(0, 20),
    educations: (parsed.educations || [])
      .slice(0, 10)
      .map((e) => ({
        ...e,
        degree: degrees.includes(e.degree || "")
          ? (e.degree as ResumeImportInput["educations"][number]["degree"])
          : undefined,
      })),
    languages: (parsed.languages || [])
      .slice(0, 15)
      .map((l) => ({
        ...l,
        level: levels.includes(l.level || "")
          ? (l.level as ResumeImportInput["languages"][number]["level"])
          : undefined,
      })),
  };
  return {
    data,
    basics: true,
    skills: data.skills.map(skill => Boolean(skill.trim())),
    experiences: data.experiences.map(completeExperience),
    educations: data.educations.map(education => Boolean(education.school.trim())),
    languages: data.languages.map(language => Boolean(language.name.trim() && language.level)),
  };
}
export function selectedReview(review: OnboardingReview, noExperience = false): ResumeImportInput {
  const d = review.data;
  return {
    replaceExisting: false,
    ...(review.basics
      ? { headline: d.headline, summary: d.summary }
      : {}),
    skills: d.skills.filter((_, i) => review.skills[i]),
    experiences: noExperience ? [] : d.experiences.filter((_, i) => review.experiences[i]),
    educations: d.educations.filter((_, i) => review.educations[i]),
    languages: d.languages.filter((_, i) => review.languages[i]),
  };
}
export function CvReview({
  value,
  onChange,
  countries,
  noExperience,
}: {
  value: OnboardingReview;
  onChange: (v: OnboardingReview) => void;
  countries: Country[];
  noExperience: boolean;
}) {
  const t = useOnboardingText(),
    enumLabel = useEnumLabel(),
    [editing, setEditing] = useState<number | null>(null),
    d = value.data;
  function select(
    key: "skills" | "experiences" | "educations" | "languages",
    index: number,
    checked: boolean,
  ) {
    onChange({
      ...value,
      [key]: value[key].map((v, i) => (i === index ? checked : v)),
    });
  }
  function field<K extends keyof ResumeImportInput>(
    key: K,
    v: ResumeImportInput[K],
  ) {
    onChange({ ...value, data: { ...d, [key]: v } });
  }
  return (
    <div className={s.review}>
      <p className={s.success}>{t("readSuccess")}</p>
      {!noExperience &&
        d.experiences.map((exp, index) => (
          <article key={index} className={s.card}>
            <div className={s.cardTop}>
              <span className={s.tag}>{t("found")}</span>
              <button
                type="button"
                className={s.textButton}
                onClick={() => setEditing(index)}
              >
                {t("edit")}
              </button>
            </div>
            <h3>{exp.title || t('position')}</h3>
            <p>{exp.companyName || t('company')}</p>
            {!completeExperience(exp) && <p className={s.muted}>{t("missingExperience")}</p>}
            <p>
              {exp.startDate || "-"} -{" "}
              {exp.isCurrent ? t("current") : exp.endDate || "-"}
            </p>
            {exp.description && <p>{exp.description}</p>}
            <label className={s.check}>
              <input
                type="checkbox"
                checked={Boolean(value.experiences[index])}
                onChange={(e) => select("experiences", index, e.target.checked)}
              />
              {t("include")}
            </label>
          </article>
        ))}
      {!d.experiences.length && (
        <p className={s.muted}>{t("missingExperience")}</p>
      )}
      <details>
        <summary>{t("otherDetails")}</summary>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={value.basics}
            onChange={(e) => onChange({ ...value, basics: e.target.checked })}
          />
          {t("include")}
        </label>
        <label>
          {t("headline")}
          <input
            value={d.headline || ""}
            maxLength={200}
            onChange={(e) => field("headline", e.target.value)}
          />
        </label>
        <label>
          {t("summary")}
          <textarea
            value={d.summary || ""}
            maxLength={5000}
            onChange={(e) => field("summary", e.target.value)}
          />
        </label>
      </details>
      <details open>
        <summary>
          {t("skills")} ({d.skills.length})
        </summary>
        {d.skills.map((skill, i) => (
          <div className={s.reviewRow} key={i}>
            <div className={s.row}>
              <input
                type="checkbox"
                aria-label={`${t("include")}: ${skill}`}
                checked={Boolean(value.skills[i])}
                onChange={(e) => select("skills", i, e.target.checked)}
              />
              <input
                aria-label={t("skills")}
                maxLength={80}
                value={skill}
                onChange={(e) =>
                  field(
                    "skills",
                    d.skills.map((v, j) => (j === i ? e.target.value : v)),
                  )
                }
              />
            </div>
          </div>
        ))}
      </details>
      <details open>
        <summary>
          {t("education")} ({d.educations.length})
        </summary>
        {d.educations.map((edu, i) => (
          <div className={s.reviewRow} key={i}>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={Boolean(value.educations[i])}
                onChange={(e) => select("educations", i, e.target.checked)}
              />
              {t("include")}
            </label>
            <input
              aria-label={t("education")}
              value={edu.school}
              maxLength={200}
              onChange={(e) =>
                field(
                  "educations",
                  d.educations.map((v, j) =>
                    j === i ? { ...v, school: e.target.value } : v,
                  ),
                )
              }
            />
            <input
              aria-label={t("description")}
              value={edu.field || ""}
              maxLength={160}
              onChange={(e) =>
                field(
                  "educations",
                  d.educations.map((v, j) =>
                    j === i ? { ...v, field: e.target.value } : v,
                  ),
                )
              }
            />
            <select
              aria-label={t("education")}
              value={edu.degree || ""}
              onChange={(e) =>
                field(
                  "educations",
                  d.educations.map((v, j) =>
                    j === i
                      ? {
                          ...v,
                          degree: (e.target.value ||
                            undefined) as typeof edu.degree,
                        }
                      : v,
                  ),
                )
              }
            >
              <option value="">-</option>
              {["HIGH_SCHOOL", "VOCATIONAL", "BACHELOR", "MASTER", "PHD"].map(
                (v) => (
                  <option key={v} value={v}>
                    {enumLabel("degree", v)}
                  </option>
                ),
              )}
            </select>
            <div className={s.twoColumns}>
              {(["startDate", "endDate"] as const).map((key) => (
                <label key={key}>
                  {t(key === "startDate" ? "start" : "end")}
                  <input
                    type="date"
                    value={edu[key]?.slice(0, 10) || ""}
                    onChange={(e) =>
                      field(
                        "educations",
                        d.educations.map((v, j) =>
                          j === i ? { ...v, [key]: e.target.value || null } : v,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </details>
      <details open>
        <summary>
          {t("languages")} ({d.languages.length})
        </summary>
        {d.languages.map((lang, i) => (
          <div className={s.reviewRow} key={i}>
            <div className={s.row}>
              <input
                type="checkbox"
                aria-label={`${t("include")}: ${lang.name}`}
                checked={Boolean(value.languages[i])}
                onChange={(e) => select("languages", i, e.target.checked)}
              />
              <input
                aria-label={t("languages")}
                value={lang.name}
                maxLength={80}
                onChange={(e) =>
                  field(
                    "languages",
                    d.languages.map((v, j) =>
                      j === i ? { ...v, name: e.target.value, code: undefined } : v,
                    ),
                  )
                }
              />
              <select
                aria-label={t("languages")}
                value={lang.level || ""}
                onChange={(e) =>
                  field(
                    "languages",
                    d.languages.map((v, j) =>
                      j === i
                        ? {
                            ...v,
                            level: (e.target.value ||
                              undefined) as typeof lang.level,
                          }
                        : v,
                    ),
                  )
                }
              >
                <option value="">-</option>
                {["A1", "A2", "B1", "B2", "C1", "C2", "NATIVE"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </details>
      <p className={s.muted}>{t("reviewSaveHint")}</p>
      {editing !== null && (
        <ExperienceEditor
          requireStart={false}
          initial={d.experiences[editing]}
          countries={countries}
          onClose={() => setEditing(null)}
          onSave={(v) => {
            field(
              "experiences",
              d.experiences.map((exp, i) => (i === editing ? v : exp)),
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
