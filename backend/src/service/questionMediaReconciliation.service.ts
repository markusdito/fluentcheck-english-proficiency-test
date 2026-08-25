import { prisma } from "../config/db.js";
import {
  AUDIO_KEY_RE,
  AUDIO_MIME_RE,
  inspectPromptMedia as inspectStoredPromptMedia,
  type PromptMediaInspection,
} from "./upload.service.js";

export type QuestionMediaReferenceStatus = "REFERENCED" | "UNREFERENCED";
export type QuestionMediaReconciliationStatus =
  | "PRESENT"
  | "MISSING"
  | "INVALID_METADATA"
  | "NO_MEDIA"
  | "INCONSISTENT"
  | "STORAGE_ERROR";
export type PromptMediaMetadataStatus = "VALID" | "INVALID" | "ABSENT";
export type PromptMediaExistenceStatus =
  | "PRESENT"
  | "MISSING"
  | "NOT_CHECKED"
  | "CHECK_FAILED";

interface RetiredQuestionMediaSnapshot {
  id: string;
  answerCount: number;
  audioStorageKey: string | null;
  audioMimeType: string | null;
  audioSizeBytes: number | null;
  audioUploadStatus: string;
}

export interface QuestionMediaReconciliationRecord {
  questionId: string;
  referenceStatus: QuestionMediaReferenceStatus;
  answerCount: number;
  status: QuestionMediaReconciliationStatus;
  metadataStatus: PromptMediaMetadataStatus;
  existenceStatus: PromptMediaExistenceStatus;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadStatus: string;
  observedMimeType: string | null;
  observedSizeBytes: number | null;
  reasons: string[];
}

export interface QuestionMediaReconciliationTotals {
  questions: number;
  referenced: number;
  unreferenced: number;
  present: number;
  missing: number;
  invalidMetadata: number;
  noMedia: number;
  inconsistent: number;
  storageError: number;
  mediaPresent: number;
  mediaMissing: number;
  mediaNotChecked: number;
  mediaCheckFailed: number;
}

export interface QuestionMediaReconciliationResult {
  generatedAt: string;
  records: QuestionMediaReconciliationRecord[];
  totals: QuestionMediaReconciliationTotals;
  exitCode: 0 | 1;
}

interface ReconciliationDependencies {
  inspectPromptMedia?: (
    storageKey: string,
  ) => Promise<PromptMediaInspection>;
}

function metadataProblems(question: RetiredQuestionMediaSnapshot) {
  const reasons: string[] = [];
  if (!question.audioStorageKey) {
    reasons.push("Prompt media storage identity is missing");
  } else {
    if (!AUDIO_KEY_RE.test(question.audioStorageKey)) {
      reasons.push("Prompt media storage identity is invalid");
    }
    if (!question.audioStorageKey.startsWith(`questions/${question.id}/`)) {
      reasons.push("Prompt media storage identity belongs to another Question");
    }
  }
  if (!question.audioMimeType || !AUDIO_MIME_RE.test(question.audioMimeType)) {
    reasons.push("Prompt media MIME type is missing or invalid");
  }
  if (question.audioSizeBytes == null || question.audioSizeBytes <= 0) {
    reasons.push("Prompt media measured size is missing or empty");
  }
  if (question.audioUploadStatus !== "UPLOADED") {
    reasons.push("Prompt media upload status is not UPLOADED");
  }
  return reasons;
}

function makeRecord(
  question: RetiredQuestionMediaSnapshot,
  status: QuestionMediaReconciliationStatus,
  metadataStatus: PromptMediaMetadataStatus,
  existenceStatus: PromptMediaExistenceStatus,
  reasons: string[],
  inspection?: PromptMediaInspection,
): QuestionMediaReconciliationRecord {
  return {
    questionId: question.id,
    referenceStatus:
      question.answerCount > 0 ? "REFERENCED" : "UNREFERENCED",
    answerCount: question.answerCount,
    status,
    metadataStatus,
    existenceStatus,
    storageKey: question.audioStorageKey,
    mimeType: question.audioMimeType,
    sizeBytes: question.audioSizeBytes,
    uploadStatus: question.audioUploadStatus,
    observedMimeType: inspection?.contentType ?? null,
    observedSizeBytes: inspection?.contentLength ?? null,
    reasons,
  };
}

function summarize(records: QuestionMediaReconciliationRecord[]) {
  return records.reduce<QuestionMediaReconciliationTotals>(
    (totals, record) => {
      totals.questions += 1;
      if (record.referenceStatus === "REFERENCED") totals.referenced += 1;
      else totals.unreferenced += 1;

      const statusField: Record<
        QuestionMediaReconciliationStatus,
        keyof Omit<
          QuestionMediaReconciliationTotals,
          "questions" | "referenced" | "unreferenced"
        >
      > = {
        PRESENT: "present",
        MISSING: "missing",
        INVALID_METADATA: "invalidMetadata",
        NO_MEDIA: "noMedia",
        INCONSISTENT: "inconsistent",
        STORAGE_ERROR: "storageError",
      };
      totals[statusField[record.status]] += 1;
      const existenceField: Record<
        PromptMediaExistenceStatus,
        | "mediaPresent"
        | "mediaMissing"
        | "mediaNotChecked"
        | "mediaCheckFailed"
      > = {
        PRESENT: "mediaPresent",
        MISSING: "mediaMissing",
        NOT_CHECKED: "mediaNotChecked",
        CHECK_FAILED: "mediaCheckFailed",
      };
      totals[existenceField[record.existenceStatus]] += 1;
      return totals;
    },
    {
      questions: 0,
      referenced: 0,
      unreferenced: 0,
      present: 0,
      missing: 0,
      invalidMetadata: 0,
      noMedia: 0,
      inconsistent: 0,
      storageError: 0,
      mediaPresent: 0,
      mediaMissing: 0,
      mediaNotChecked: 0,
      mediaCheckFailed: 0,
    },
  );
}

export async function reconcileRetiredQuestionMedia(
  dependencies: ReconciliationDependencies = {},
): Promise<QuestionMediaReconciliationResult> {
  const inspectPromptMedia =
    dependencies.inspectPromptMedia ?? inspectStoredPromptMedia;
  const questionRows = await prisma.question.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      audioStorageKey: true,
      audioMimeType: true,
      audioSizeBytes: true,
      audioUploadStatus: true,
      _count: { select: { answers: true } },
    },
  });
  const questions: RetiredQuestionMediaSnapshot[] = questionRows.map(
    ({ _count, ...question }) => ({
      ...question,
      answerCount: _count.answers,
    }),
  );

  const records: QuestionMediaReconciliationRecord[] = [];
  for (const question of questions) {
    const hasNoMediaMetadata =
      !question.audioStorageKey &&
      !question.audioMimeType &&
      question.audioSizeBytes == null &&
      question.audioUploadStatus !== "UPLOADED";
    if (hasNoMediaMetadata) {
      records.push(
        makeRecord(
          question,
          "NO_MEDIA",
          "ABSENT",
          "NOT_CHECKED",
          ["No Prompt media metadata is recorded"],
        ),
      );
      continue;
    }

    const problems = metadataProblems(question);
    const metadataStatus: PromptMediaMetadataStatus =
      problems.length > 0 ? "INVALID" : "VALID";
    const hasSafeStorageIdentity =
      question.audioStorageKey != null &&
      AUDIO_KEY_RE.test(question.audioStorageKey) &&
      question.audioStorageKey.startsWith(`questions/${question.id}/`);
    if (!hasSafeStorageIdentity) {
      records.push(
        makeRecord(
          question,
          "INVALID_METADATA",
          metadataStatus,
          "NOT_CHECKED",
          problems,
        ),
      );
      continue;
    }

    try {
      const inspection = await inspectPromptMedia(question.audioStorageKey!);
      if (!inspection.exists) {
        records.push(
          makeRecord(
            question,
            problems.length > 0 ? "INVALID_METADATA" : "MISSING",
            metadataStatus,
            "MISSING",
            [...problems, "Prompt media is missing from storage"],
            inspection,
          ),
        );
        continue;
      }

      const inconsistencies: string[] = [];
      if (
        question.audioSizeBytes != null &&
        question.audioSizeBytes > 0 &&
        inspection.contentLength !== question.audioSizeBytes
      ) {
        inconsistencies.push(
          `Storage size ${inspection.contentLength ?? "unknown"} does not match recorded size ${question.audioSizeBytes}`,
        );
      }
      if (
        question.audioMimeType != null &&
        AUDIO_MIME_RE.test(question.audioMimeType) &&
        inspection.contentType !== question.audioMimeType
      ) {
        inconsistencies.push(
          `Storage MIME type ${inspection.contentType ?? "unknown"} does not match recorded MIME type ${question.audioMimeType}`,
        );
      }
      records.push(
        makeRecord(
          question,
          problems.length > 0
            ? "INVALID_METADATA"
            : inconsistencies.length > 0
              ? "INCONSISTENT"
              : "PRESENT",
          metadataStatus,
          "PRESENT",
          [...problems, ...inconsistencies],
          inspection,
        ),
      );
    } catch (error) {
      records.push(
        makeRecord(
          question,
          "STORAGE_ERROR",
          metadataStatus,
          "CHECK_FAILED",
          [
            ...problems,
            error instanceof Error
              ? error.message
              : "Prompt media inspection failed",
          ],
        ),
      );
    }
  }

  const totals = summarize(records);
  const hasReferencedEvidenceFailure = records.some(
    (record) =>
      record.referenceStatus === "REFERENCED" && record.status !== "PRESENT",
  );
  const inspectionIncomplete = totals.storageError > 0;
  return {
    generatedAt: new Date().toISOString(),
    records,
    totals,
    exitCode: hasReferencedEvidenceFailure || inspectionIncomplete ? 1 : 0,
  };
}

export function formatHumanReconciliation(
  result: QuestionMediaReconciliationResult,
) {
  const recordLines = result.records.map((record) => {
    const reasons =
      record.reasons.length > 0 ? ` - ${record.reasons.join("; ")}` : "";
    return `${record.questionId} ${record.referenceStatus} ${record.status} metadata=${record.metadataStatus} promptMedia=${record.existenceStatus}${reasons}`;
  });
  const totals = result.totals;
  return [
    "Retired Question Prompt media reconciliation",
    ...recordLines,
    "",
    `Questions: ${totals.questions}`,
    `Referenced: ${totals.referenced}`,
    `Unreferenced: ${totals.unreferenced}`,
    `Present: ${totals.present}`,
    `Missing: ${totals.missing}`,
    `Invalid metadata: ${totals.invalidMetadata}`,
    `No media: ${totals.noMedia}`,
    `Inconsistent: ${totals.inconsistent}`,
    `Storage errors: ${totals.storageError}`,
    `Prompt media present: ${totals.mediaPresent}`,
    `Prompt media missing: ${totals.mediaMissing}`,
    `Prompt media not checked: ${totals.mediaNotChecked}`,
    `Prompt media checks failed: ${totals.mediaCheckFailed}`,
  ].join("\n");
}
