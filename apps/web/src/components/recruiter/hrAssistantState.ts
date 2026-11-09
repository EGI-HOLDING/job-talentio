/** Browser-only presentation progress; publication/onboarding state stays on the server. */
export const assistantScenes = ['taka-intro', 'cv-sources', 'cv-ranking', 'tara-intro', 'chat-demo', 'voice-demo', 'cv-upload'] as const;
export type AssistantSceneId = typeof assistantScenes[number];
export const assistantProgressKey = (userId: string, creationSessionId: string) =>
  `talentio:hr-assistant:${userId}:${creationSessionId}`;

export function readAssistantProgress(userId: string, creationSessionId: string): AssistantSceneId | null {
  if (!userId || !creationSessionId || typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(assistantProgressKey(userId, creationSessionId));
    return assistantScenes.includes(value as AssistantSceneId) ? value as AssistantSceneId : null;
  } catch { return null; }
}

export function saveAssistantProgress(userId: string, creationSessionId: string, scene: AssistantSceneId) {
  if (!userId || !creationSessionId || typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(assistantProgressKey(userId, creationSessionId), scene); } catch { /* The story also works with storage disabled. */ }
}

export function clearAssistantProgress(userId: string, creationSessionId: string) {
  if (!userId || !creationSessionId || typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(assistantProgressKey(userId, creationSessionId)); } catch { /* Browser storage is optional. */ }
}
