'use client';

import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { floatingPanelPosition, type FloatingPanelPosition } from "@/components/ui/floatingPanelPosition";
import { WorkspaceIcon } from "@/components/employee/WorkspaceIcon";
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
function countryPanelPosition(rect: DOMRect): FloatingPanelPosition {
  const measured = floatingPanelPosition(rect, 340);
  if (measured) return measured;

  // Keep the picker available even when the trigger nearly fills a short viewport.
  const edge = 8;
  const width = Math.min(rect.width, Math.max(1, window.innerWidth - edge * 2));
  const maxHeight = Math.max(1, Math.min(340, window.innerHeight - edge * 2));
  const left = Math.min(Math.max(edge, rect.left), Math.max(edge, window.innerWidth - edge - width));
  const top = Math.min(Math.max(edge, rect.bottom + 6), Math.max(edge, window.innerHeight - edge - maxHeight));
  return { left, top, width, maxHeight };
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnOpen = useRef(false);
  const [position, setPosition] = useState<FloatingPanelPosition | null>(null);
  const options = countries.filter((c) =>
    `${countryName(c, locale)} ${c.name} ${c.iso2 || ""}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  function toggle(country: Country) {
    if (single) {
      onChange([country.id]);
      focusSearchOnOpen.current = false;
      setOpen(false);
      setSearch("");
      buttonRef.current?.focus();
    } else
      onChange(
        value.includes(country.id)
          ? value.filter((v) => v !== country.id)
          : value.length < 10
            ? [...value, country.id]
            : value,
      );
  }
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPosition(countryPanelPosition(rect));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: Event) => {
      const target = event.target as Node;
      // Focus can move before the portaled panel has mounted on the first open.
      // Ignore that transient event; the panel owns focus as soon as it exists.
      if (event.type === "focusin" && !panelRef.current) return;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        focusSearchOnOpen.current = false;
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !position || !focusSearchOnOpen.current) return;
    focusSearchOnOpen.current = false;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, position]);
  return (
    <div className={s.fields}>
      <label htmlFor={id}>{label || t("countries")}</label>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={s.pickerButton}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => {
          const next = !open;
          focusSearchOnOpen.current = next;
          if (next) {
            const rect = buttonRef.current?.getBoundingClientRect();
            setPosition(rect ? countryPanelPosition(rect) : null);
          }
          setOpen(next);
        }}
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
        <WorkspaceIcon kind="chevronDown" />
      </button>
      {open && position && createPortal(
        <div
          ref={panelRef}
          id={`${id}-options`}
          className={s.countryOptions}
          style={{ ...position, position: "fixed", height: position.maxHeight, zIndex: 10050, boxSizing: "border-box" }}
          onKeyDown={(event) => { if (event.key === "Escape") { focusSearchOnOpen.current = false; setOpen(false); setSearch(""); buttonRef.current?.focus(); } }}
        >
          <input
            ref={searchRef}
            aria-label={t("searchCountry")}
            placeholder={t("searchCountry")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
        </div>,
        buttonRef.current?.closest("dialog") || document.body,
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
                {code} - {currencyNames.of(code)}
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
