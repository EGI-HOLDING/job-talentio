import type { Locale } from '@/lib/locale';
import { LEGAL_DOCS, LEGAL_UPDATED_LABEL, type LegalDocKey } from '@/lib/i18n/legal';

/** Server-rendered legal text; content comes from the locale dictionary. */
export function LegalDocument({ kind, locale }: { kind: LegalDocKey; locale: Locale }) {
  const doc = LEGAL_DOCS[kind][locale];
  return (
    <article className="shell legal-doc">
      <h1>{doc.title}</h1>
      <p className="legal-meta">
        {LEGAL_UPDATED_LABEL[locale]}: {doc.updated}
      </p>
      <p>{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {(section.paragraphs || []).map((text) => (
            <p key={text}>{text}</p>
          ))}
          {section.items && section.items.length > 0 ? (
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
