export const ASSESSMENT_START_INTENT_STORAGE_KEY = "fluentcheck.assessment-start-key";

interface StoredAssessmentStartIntent {
  studentId: string;
  key: string;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredIntent(studentId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(ASSESSMENT_START_INTENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as Partial<StoredAssessmentStartIntent>;
    if (stored.studentId === studentId && typeof stored.key === "string" && stored.key.length > 0) {
      return stored.key;
    }
  } catch {
    // The previous release stored a bare key. Treat it as stale rather than
    // risking reuse after an account transition.
  }

  try {
    storage.removeItem(ASSESSMENT_START_INTENT_STORAGE_KEY);
  } catch {
    // Storage may be unavailable even after a successful read.
  }
  return null;
}

function createKey(): string {
  return crypto.randomUUID();
}

function storeIntent(studentId: string, key: string): string {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(
        ASSESSMENT_START_INTENT_STORAGE_KEY,
        JSON.stringify({ studentId, key } satisfies StoredAssessmentStartIntent),
      );
    } catch {
      // The server remains authoritative if per-tab storage is blocked.
    }
  }
  return key;
}

export function getOrCreateAssessmentStartIntent(studentId: string): string {
  return readStoredIntent(studentId) ?? storeIntent(studentId, createKey());
}

export function rotateAssessmentStartIntent(studentId: string): string {
  return storeIntent(studentId, createKey());
}

export function clearAssessmentStartIntent(): void {
  getStorage()?.removeItem(ASSESSMENT_START_INTENT_STORAGE_KEY);
}
