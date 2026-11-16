import type { TaraInterviewNotes as Notes } from '@/components/recruiter/screening-view';
import { assessmentCopy, type AssessmentLanguage } from '@job-talentio/shared';

const labels: Record<string, string> = {
  CONCRETE_EXAMPLE: 'Ada contoh konkret',
  INCOMPLETE_EXAMPLE: 'Ada contoh relevan, sebagian bukti masih kurang',
  NO_RELEVANT_EXAMPLE: 'Sudah ditanya, belum ada contoh relevan',
  CLARIFIED_DISCREPANCY: 'Ada ketidaksesuaian setelah klarifikasi',
  NOT_ASKED: 'Belum sempat ditanya',
  TECHNICAL_INTERRUPTION: 'Kesempatan menjawab terganggu secara teknis',
  ANSWER_CUT_SHORT: 'Jawaban belum sempat ditinjau saat giliran berakhir',
};
const fields: Record<string, string> = {
  TASK:'Tugas yang dikerjakan', ACTION:'Tindakan pribadi', CONTEXT:'Konteks pengalaman',
  RESULT:'Hasil', ROLE_BOUNDARY:'Batas kontribusi',
};
const reasons: Record<string, string> = {
  AFTER_REDIRECT:'Tara sudah mengarahkan kandidat kembali ke pertanyaan.',
  NO_RESPONSE:'Belum ada jawaban yang tersimpan.',
  TIME_LIMIT:'Jatah waktu berakhir.',
  DELIVERY_FAILED:'Penyampaian pertanyaan gagal.',
  ANALYSIS_UNAVAILABLE:'Jawaban tersimpan saat analisis belum tersedia.',
  INTERRUPTED:'Percakapan berakhir sebelum topik selesai.',
};

export function TaraInterviewNotes({ notes, onContext, assessmentLanguage }: {
  notes: Notes;
  assessmentLanguage?: AssessmentLanguage;
  onContext?: (topicId: string, ref: string, answer: boolean) => void;
}) {
  const c=(text:string)=>assessmentCopy(assessmentLanguage,text);
  return <section aria-label={c('Catatan wawancara Tara')}>
    <h4>{c('Catatan wawancara Tara')}</h4>
    <ul>{notes.topics.map(topic => <li key={topic.topicId}>
      <strong>{topic.alternative ? c('Pengalaman di luar CV \u00b7 ') + topic.label : topic.label}</strong>
      <p>{c(labels[topic.outcome] ?? 'Catatan tersedia di percakapan')}</p>
      {topic.reason && reasons[topic.reason] && <p>{c(reasons[topic.reason])}</p>}
      {topic.fields && <p>{c('Bukti yang dicari')} &#xb7; {topic.fields.map(field=>c(fields[field]??field)).join(', ')}</p>}
      {topic.requirementRef && <p>{c('Tugas lowongan')} &#xb7; {topic.requirementRef}</p>}
      {topic.opportunities?.some(opportunity=>opportunity.delivery==='TEXT_FALLBACK') && <p>{c('Pertanyaan disampaikan lewat teks saat wawancara suara.')}</p>}
      {topic.evidence?.length ? <ul>{topic.evidence.map((evidence,index)=><li key={evidence.answerRef+':'+index}>
        <blockquote>{evidence.quote}</blockquote>
        {onContext&&<button type="button" onClick={()=>onContext(topic.topicId,evidence.answerRef,true)}>{c('Lihat kutipan jawaban')}</button>}
      </li>)}</ul> : topic.quote && <blockquote>{topic.quote}</blockquote>}
      {onContext && topic.questionRefs.length > 0 && <button type="button"
        onClick={() => onContext(topic.topicId, topic.answerRefs.at(-1) ?? topic.questionRefs.at(-1)!, topic.answerRefs.length > 0)}>
        {c('Lihat konteks percakapan')}
      </button>}
    </li>)}</ul>
    {notes.topics.some(topic => topic.alternative) && <p>{c('Pengalaman alternatif dicatat terpisah dari skor dukungan klaim CV.')}</p>}
  </section>;
}
