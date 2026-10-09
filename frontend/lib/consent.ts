/**
 * PRD FR-2.6: informed consent shown before any capture. The backend records
 * this version on the Submission and refuses a start without it, so bump it
 * together with CONSENT_TEXT_VERSION in the backend whenever the text changes.
 */
export const CONSENT_TEXT_VERSION = "2026-10-09";

export const CONSENT_POINTS: Array<{ title: string; body: string }> = [
  {
    title: "What is recorded",
    body: "Every answer is recorded as a video from your webcam and microphone. Nothing is recorded while you prepare or while the question audio plays.",
  },
  {
    title: "Why",
    body: "Two independent Examiners watch your answer videos to score your speaking and to check the test was taken fairly.",
  },
  {
    title: "Who can see it",
    body: "Only the Examiners assigned to your test and FluentCheck administrators.",
  },
  {
    title: "How long it is kept",
    body: "Answer videos are deleted after the scoring period, in line with Indonesia's Personal Data Protection Law (UU PDP). Your result stays in your account.",
  },
  {
    title: "System check clip",
    body: "The test clip you record in the system check stays on this device and is never uploaded.",
  },
];

const STORAGE_KEY = "fluentcheck.consent";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Consent lasts for this tab only and is bound to one student and text version. */
export function storeConsent(studentId: string): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ studentId, version: CONSENT_TEXT_VERSION }));
  } catch {
    // Blocked storage: the student is asked again; the server still refuses a start without consent.
  }
}

export function readConsent(studentId: string | null | undefined): string | null {
  if (!studentId) return null;
  try {
    const stored = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "null") as
      | { studentId?: unknown; version?: unknown }
      | null;
    return stored?.studentId === studentId && stored.version === CONSENT_TEXT_VERSION
      ? CONSENT_TEXT_VERSION
      : null;
  } catch {
    return null;
  }
}

export function clearConsent(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
