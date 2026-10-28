/** Storage keys and unreviewed parser output are service internals. Downloads
 * must go through the authorization checks on the dedicated download route. */
export function submittedResume(snapshot: unknown, live?: { fileKey?: string | null; title?: string | null } | null) {
  const known = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    Object.prototype.hasOwnProperty.call(snapshot, 'resume');
  const value = known ? (snapshot as { resume: { fileKey?: string | null; title?: string | null } | null }).resume : live;
  // An explicit empty snapshot is evidence that no file was submitted. Only
  // legacy applications without a resume snapshot may use the library fallback.
  return { fileKey: value?.fileKey ?? null, title: value?.title ?? null };
}

export function canAddToKanban(application: { status: string; kanbanEnteredAt?: Date | string | null }) {
  return !application.kanbanEnteredAt && !['WITHDRAWN', 'REJECTED', 'HIRED'].includes(application.status);
}

export function safeApplication<T extends object>(application: T) {
  const source = application as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  const answers = source.answers;
  if (Array.isArray(answers)) result.answers = answers.map(answer => ({ ...answer, question: answer.questionSnapshot && typeof answer.questionSnapshot === 'object' ? { ...answer.questionSnapshot, id: answer.questionId } : answer.question }));
  const snapshot = source.resumeSnapshot;
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const snap = snapshot as Record<string, unknown>;
    const resume = snap.resume;
    if (resume && typeof resume === 'object' && !Array.isArray(resume)) {
      const { fileKey, fileUrl, ...safeResume } = resume as Record<string, unknown>;
      result.resumeSnapshot = { ...snap, resume: { ...safeResume, hasFile: Boolean(fileKey || safeResume.hasFile) } };
    }
  }
  if (source.resume && typeof source.resume === 'object') {
    const resume = source.resume as Record<string, unknown>;
    result.resume = { id: resume.id, title: resume.title, templateKey: resume.templateKey, hasFile: Boolean(resume.fileKey) };
  }
  return result as Omit<T, 'resumeSnapshot' | 'resume'> & { resumeSnapshot?: unknown; resume?: unknown };
}
