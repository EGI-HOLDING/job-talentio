/** Persist last dashboard section so bare /dashboard/* links restore it. */

export function readStoredDashboardTab(storageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function storeDashboardTab(storageKey: string, tab: string) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey, tab);
  } catch {
    /* private mode */
  }
}

export const RECRUITER_TAB_KEY = 'jt:lastTab:recruiter';
export const EMPLOYEE_TAB_KEY = 'jt:lastTab:employee';
