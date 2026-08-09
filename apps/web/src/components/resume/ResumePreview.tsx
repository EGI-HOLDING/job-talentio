type ResumePreviewSkill = { name: string; level?: string | null };
type ResumePreviewExperience = {
  title: string;
  companyName: string;
  description?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  isCurrent?: boolean;
  location?: string | null;
};
type ResumePreviewEducation = {
  school: string;
  degree?: string | null;
  field?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
};
type ResumePreviewLanguage = { name: string; level?: string | null };
type ResumePreviewCertification = {
  name: string;
  issuer?: string | null;
  issuedAt?: string | Date | null;
  expiresAt?: string | Date | null;
};

export type ResumePreviewDocument = {
  fullName: string;
  headline?: string | null;
  summary?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  skills: ResumePreviewSkill[];
  experiences: ResumePreviewExperience[];
  educations: ResumePreviewEducation[];
  languages: ResumePreviewLanguage[];
  certifications: ResumePreviewCertification[];
};

type Props = {
  document: ResumePreviewDocument;
  templateKey: 'classic' | 'modern' | 'compact';
  themeAccent?: string | null;
};

function fmtDate(d?: string | Date | null) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function dateRange(start?: string | Date | null, end?: string | Date | null, isCurrent?: boolean) {
  const a = fmtDate(start);
  const b = isCurrent ? 'Present' : fmtDate(end);
  if (!a && !b) return '';
  return [a, b].filter(Boolean).join(' – ');
}

export function ResumePreview({ document: doc, templateKey, themeAccent }: Props) {
  const accent = themeAccent || '#0f766e';
  const contact = [doc.email, doc.phone, doc.city].filter(Boolean).join(' · ');

  return (
    <div
      className={`resume-preview resume-preview--${templateKey}`}
      style={{ ['--resume-accent' as string]: accent }}
    >
      <header className="resume-preview__header">
        <h1 className="resume-preview__name">{doc.fullName}</h1>
        {doc.headline ? <p className="resume-preview__headline">{doc.headline}</p> : null}
        {contact ? <p className="resume-preview__contact">{contact}</p> : null}
      </header>

      {doc.summary ? (
        <section className="resume-preview__section">
          <h2>Summary</h2>
          <p className="resume-preview__summary">{doc.summary}</p>
        </section>
      ) : null}

      {doc.skills.length > 0 ? (
        <section className="resume-preview__section">
          <h2>Skills</h2>
          <p className="resume-preview__skills">
            {doc.skills.map((s) => s.name).join(' · ')}
          </p>
        </section>
      ) : null}

      {doc.experiences.length > 0 ? (
        <section className="resume-preview__section">
          <h2>Experience</h2>
          {doc.experiences.map((e, i) => (
            <div key={i} className="resume-preview__item">
              <div className="resume-preview__item-head">
                <strong>
                  {e.title}
                  {e.companyName ? ` — ${e.companyName}` : ''}
                </strong>
                <span className="resume-preview__dates">
                  {dateRange(e.startDate, e.endDate, e.isCurrent)}
                </span>
              </div>
              {e.location ? <div className="resume-preview__muted">{e.location}</div> : null}
              {e.description ? (
                <p className="resume-preview__desc">{e.description}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {doc.educations.length > 0 ? (
        <section className="resume-preview__section">
          <h2>Education</h2>
          {doc.educations.map((e, i) => (
            <div key={i} className="resume-preview__item">
              <div className="resume-preview__item-head">
                <strong>{e.school}</strong>
                <span className="resume-preview__dates">
                  {dateRange(e.startDate, e.endDate)}
                </span>
              </div>
              <div className="resume-preview__muted">
                {[e.degree ? String(e.degree).replace(/_/g, ' ') : null, e.field]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {doc.languages.length > 0 ? (
        <section className="resume-preview__section">
          <h2>Languages</h2>
          <p className="resume-preview__skills">
            {doc.languages.map((l) => `${l.name}${l.level ? ` (${l.level})` : ''}`).join(' · ')}
          </p>
        </section>
      ) : null}

      {doc.certifications.length > 0 ? (
        <section className="resume-preview__section">
          <h2>Certifications</h2>
          {doc.certifications.map((c, i) => (
            <div key={i} className="resume-preview__item">
              <strong>{c.name}</strong>
              {c.issuer ? <div className="resume-preview__muted">{c.issuer}</div> : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
