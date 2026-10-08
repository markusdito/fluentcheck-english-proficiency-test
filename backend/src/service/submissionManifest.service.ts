/** Stable identity used at the Legacy/manifest compatibility boundary. */
export interface SubmissionManifestIdentity {
  id: string;
  version: number;
}

/** The Test Set a version 2 manifest was delivered from, as snapshotted. */
export interface DeliveredTestSet {
  id: string;
  code: string;
}

/** Legacy (version 1) manifests and Legacy Submissions have no Test Set. */
export function deliveredTestSet(
  manifest: { testSetId: string | null; testSetCode: string | null } | null | undefined,
): DeliveredTestSet | null {
  return manifest?.testSetId && manifest.testSetCode
    ? { id: manifest.testSetId, code: manifest.testSetCode }
    : null;
}

export type SubmissionEvidence =
  | { kind: "LEGACY" }
  | { kind: "MANIFEST"; manifest: SubmissionManifestIdentity };

/**
 * Absence is the deliberate Legacy compatibility boundary. Callers must branch
 * on this result instead of reconstructing evidence from the current Question bank.
 */
export function classifySubmissionEvidence(
  manifest: SubmissionManifestIdentity | null,
): SubmissionEvidence {
  return manifest
    ? { kind: "MANIFEST", manifest }
    : { kind: "LEGACY" };
}

export function assertLegacySubmissionEvidence(
  manifest: SubmissionManifestIdentity | null,
): void {
  if (classifySubmissionEvidence(manifest).kind !== "LEGACY") {
    throw new Error(
      "Legacy reader cannot interpret Manifest-backed Submission evidence",
    );
  }
}

export function assertLegacyAnswerQuestion<
  T extends { questionId: string | null; question: unknown | null },
>(
  answer: T,
): asserts answer is T & { questionId: string; question: NonNullable<T["question"]> } {
  if (!answer.questionId || !answer.question) {
    throw new Error(
      "Legacy reader cannot interpret Manifest-backed Answer evidence",
    );
  }
}
