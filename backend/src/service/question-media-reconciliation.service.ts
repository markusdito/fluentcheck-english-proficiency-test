import { prisma } from "../config/db.js";
import {
  AUDIO_KEY_RE,
  AUDIO_MIME_RE,
  inspectQuestionAudioObject,
  type QuestionAudioObjectInspection,
} from "./upload.service.js";

export type QuestionMediaReferenceStatus = "REFERENCED" | "UNREFERENCED";
export type QuestionMediaReconciliationStatus =
  | "PRESENT"
  | "MISSING"
  | "INVALID_METADATA"
  | "NO_MEDIA"
  | "INCONSISTENT"
  | "STORAGE_ERROR";

export interface QuestionMediaReconciliationRecord {
  questionId: string;
  referenceStatus: QuestionMediaReferenceStatus;
  answerCount: number;
  status: QuestionMediaReconciliationStatus;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadStatus: string;
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
  ) => Promise<QuestionAudioObjectInspection>;
}

function metadataProblems(question: {
  id: string;
  audioStorageKey: string | null;
  audioMimeType: string | null;
  audioSizeBytes: number | null;
  audioUploadStatus: string;
}) {
  const reasons: string[] = [];
  if (!question.audioStorageKey) {
    reasons.push("Prompt-media storage identity is missing");
  } else {
    if (!AUDIO_KEY_RE.test(question.audioStorageKey)) {
      reasons.push("Prompt-media storage identity is invalid");
    }
    if (!question.audioStorageKey.startsWith(`questions/${question.id}/`)) {
      reasons.push("Prompt-media storage identity belongs to another Question");
    }
  }
  if (!question.audioMimeType || !AUDIO_MIME_RE.test(question.audioMimeType)) {
    reasons.push("Prompt-media MIME type is missing or invalid");
  }
  if (question.audioSizeBytes == null || question.audioSizeBytes <= 0) {
    reasons.push("Prompt-media measured size is missing or empty");
  }
  if (question.audioUploadStatus !== "UPLOADED") {
    reasons.push("Prompt-media upload status is not UPLOADED");
  }
  return reasons;
}

function makeRecord(
  question: {
    id: string;
    audioStorageKey: string | null;
    audioMimeType: string | null;
    audioSizeBytes: number | null;
    audioUploadStatus: string;
    _count: { answers: number };
  },
  status: QuestionMediaReconciliationStatus,
  reasons: string[],
): QuestionMediaReconciliationRecord {
  return {
    questionId: question.id,
    referenceStatus:
      question._count.answers > 0 ? "REFERENCED" : "UNREFERENCED",
    answerCount: question._count.answers,
    status,
    storageKey: question.audioStorageKey,
    mimeType: question.audioMimeType,
    sizeBytes: question.audioSizeBytes,
    uploadStatus: question.audioUploadStatus,
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
    },
  );
}

export async function reconcileRetiredQuestionMedia(
  dependencies: ReconciliationDependencies = {},
): Promise<QuestionMediaReconciliationResult> {
  const inspectPromptMedia =
    dependencies.inspectPromptMedia ?? inspectQuestionAudioObject;
  const questions = await prisma.question.findMany({
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

  const records: QuestionMediaReconciliationRecord[] = [];
  for (const question of questions) {
    const hasNoMediaMetadata =
      !question.audioStorageKey &&
      !question.audioMimeType &&
      question.audioSizeBytes == null &&
      question.audioUploadStatus !== "UPLOADED";
    if (hasNoMediaMetadata) {
      records.push(
        makeRecord(question, "NO_MEDIA", [
          "No Prompt-media metadata is recorded",
        ]),
      );
      continue;
    }

    const problems = metadataProblems(question);
    if (problems.length > 0) {
      records.push(makeRecord(question, "INVALID_METADATA", problems));
      continue;
    }

    try {
      const inspection = await inspectPromptMedia(question.audioStorageKey!);
      if (!inspection.exists) {
        records.push(
          makeRecord(question, "MISSING", [
            "Prompt-media object is missing from storage",
          ]),
        );
        continue;
      }

      const inconsistencies: string[] = [];
      if (inspection.contentLength !== question.audioSizeBytes) {
        inconsistencies.push(
          `Storage size ${inspection.contentLength ?? "unknown"} does not match recorded size ${question.audioSizeBytes}`,
        );
      }
      if (inspection.contentType !== question.audioMimeType) {
        inconsistencies.push(
          `Storage MIME type ${inspection.contentType ?? "unknown"} does not match recorded MIME type ${question.audioMimeType}`,
        );
      }
      records.push(
        makeRecord(
          question,
          inconsistencies.length > 0 ? "INCONSISTENT" : "PRESENT",
          inconsistencies,
        ),
      );
    } catch (error) {
      records.push(
        makeRecord(question, "STORAGE_ERROR", [
          error instanceof Error ? error.message : "Storage inspection failed",
        ]),
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
    return `${record.questionId} ${record.referenceStatus} ${record.status}${reasons}`;
  });
  const totals = result.totals;
  return [
    "Retired-question Prompt-media reconciliation",
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
  ].join("\n");
}
