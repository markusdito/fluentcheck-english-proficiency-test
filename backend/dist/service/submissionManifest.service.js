/**
 * Absence is the deliberate Legacy compatibility boundary. Callers must branch
 * on this result instead of reconstructing evidence from the current Question bank.
 */
export function classifySubmissionEvidence(manifest) {
    return manifest
        ? { kind: "MANIFEST", manifest }
        : { kind: "LEGACY" };
}
export function assertLegacySubmissionEvidence(manifest) {
    if (classifySubmissionEvidence(manifest).kind !== "LEGACY") {
        throw new Error("Legacy reader cannot interpret Manifest-backed Submission evidence");
    }
}
export function assertLegacyAnswerQuestion(answer) {
    if (!answer.questionId || !answer.question) {
        throw new Error("Legacy reader cannot interpret Manifest-backed Answer evidence");
    }
}
