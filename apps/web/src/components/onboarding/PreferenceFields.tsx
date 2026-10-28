"use client";
import { useId, useState } from "react";
import { JobTitleInput } from "@/components/ui/JobTitleInput";
import { useI18n } from "@/lib/i18n";
import { useOnboardingText } from "@/lib/i18n/onboarding";
import s from "./Onboarding.module.css";

export type Country = {
  id: string;
  name: string;
  nameUz?: string;
  nameRu?: string;
  nameId?: string;
  iso2?: string;
  currencyCode?: string;
};
export function countryName(country: Country, locale: string) {
  return (
    (locale === "id"
      ? country.nameId
      : locale === "ru"
        ? country.nameRu
        : locale === "uz"
          ? country.nameUz
          : "") || country.name
  );
}
export function RoleInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const t = useOnboardingText(), id = useId();
  const [text, setText] = useState("");
  function add(input = text) {
    const role = input.trim().replace(/\s+/g, " ");
    if (!role || value.length >= 10) return;
    if (!value.some(selected => selected.toLocaleLowerCase() === role.toLocaleLowerCase())) onChange([...value, role]);
    setText("");
  }
  return <div className={s.fields}>
    <label htmlFor={id}>{t("roleLabel")}</label>
    <div className={s.inputAction}>
      <JobTitleInput id={id} name="" value={text} onValueChange={setText} onPick={add} onSubmitValue={add} normalizeSeniority={false} minLength={1} disabled={value.length >= 10} placeholder={t("rolePlaceholder")} />
      <button type="button" className={s.secondary} disabled={!text.trim() || value.length >= 10} onClick={() => add()}>{t("add")}</button>
    </div>
    <div className={s.chips}>{value.map(role => <span key={role}>{role}<button type="button" aria-label={t("remove") + ": " + role} onClick={() => onChange(value.filter(selected => selected !== role))}>×</button></span>)}</div>
    <small>{t("rolesLimit")}</small>
  </div>;
}
export function CountryPicker({
  countries,
  value,
  onChange,
  single = false,
  label,
}: {
  countries: Country[];
  value: string[];
  onChange: (v: string[]) => void;
  single?: boolean;
  label?: string;
}) {
  const t = useOnboardingText(),
    { locale } = useI18n(),
    id = useId();
  const [search, setSearch] = useState(""),
    [open, setOpen] = useState(false);
  const options = countries.filter((c) =>
    `${countryName(c, locale)} ${c.name} ${c.iso2 || ""}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  function toggle(country: Country) {
    if (single) {
      onChange([country.id]);
      setOpen(false);
      setSearch("");
    } else
      onChange(
        value.includes(country.id)
          ? value.filter((v) => v !== country.id)
          : value.length < 10
            ? [...value, country.id]
            : value,
      );
  }
  return (
    <div className={s.fields}>
      <label htmlFor={id}>{label || t("countries")}</label>
      <button
        id={id}
        type="button"
        className={s.pickerButton}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => setOpen(!open)}
      >
        {single && value[0]
          ? countryName(
              countries.find((c) => c.id === value[0]) || {
                id: value[0],
                name: value[0],
              },
              locale,
            )
          : t("searchCountry")}
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div id={`${id}-options`} className={s.countryOptions}>
          <input
            autoFocus
            aria-label={t("searchCountry")}
            placeholder={t("searchCountry")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className={s.countryScroll}>
            {options.map((c) => (
              <label
                key={c.id}
                className={value.includes(c.id) ? s.selected : ""}
              >
                <input
                  type={single ? "radio" : "checkbox"}
                  checked={value.includes(c.id)}
                  disabled={
                    !single && value.length >= 10 && !value.includes(c.id)
                  }
                  onChange={() => toggle(c)}
                />
                <span className={s.countryCode}>{c.iso2}</span>
                {countryName(c, locale)}
              </label>
            ))}
            {!options.length && <p>{t("noCountries")}</p>}
          </div>
        </div>
      )}
      {!single && (
        <div className={s.chips}>
          {value.map((id) => (
            <span key={id}>
              {countryName(
                countries.find((c) => c.id === id) || { id, name: id },
                locale,
              )}
              <button
                type="button"
                aria-label={t("remove")}
                onClick={() => onChange(value.filter((v) => v !== id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
export type SalaryValue = {
  desiredSalaryMin: number | null;
  desiredSalaryCurrency: string;
  desiredSalaryPeriod: "MONTHLY" | "YEARLY" | "HOURLY";
  salaryNegotiable: boolean;
};
export function SalaryFields({
  value,
  onChange,
  countries,
}: {
  value: SalaryValue;
  onChange: (v: SalaryValue) => void;
  countries: Country[];
}) {
  const t = useOnboardingText(),
    { locale } = useI18n();
  const currencies = [
    ...new Set([
      "USD",
      "EUR",
      ...countries
        .map((c) => c.currencyCode)
        .filter((c): c is string => Boolean(c)),
      value.desiredSalaryCurrency,
    ]),
  ].sort();
  const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });
  return (
    <div className={s.fields}>
      <div className={s.salaryGrid}>
        <label>
          {t("currency")}
          <select
            value={value.desiredSalaryCurrency}
            onChange={(e) =>
              onChange({ ...value, desiredSalaryCurrency: e.target.value })
            }
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code} — {currencyNames.of(code)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("amount")}
          <input
            type="number"
            min="0.01"
            max="1000000000000"
            step="0.01"
            inputMode="decimal"
            value={value.desiredSalaryMin ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                desiredSalaryMin: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
        </label>
        <label>
          {t("period")}
          <select
            value={value.desiredSalaryPeriod}
            onChange={(e) =>
              onChange({
                ...value,
                desiredSalaryPeriod: e.target
                  .value as SalaryValue["desiredSalaryPeriod"],
              })
            }
          >
            {(["MONTHLY", "YEARLY", "HOURLY"] as const).map((p) => (
              <option key={p} value={p}>
                {t(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={value.salaryNegotiable}
          onChange={(e) =>
            onChange({ ...value, salaryNegotiable: e.target.checked })
          }
        />
        {t("negotiable")}
      </label>
    </div>
  );
}
