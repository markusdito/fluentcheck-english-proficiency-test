import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import type {
  SubmissionFlagType,
  SubmissionStatus,
} from "../generated/enums.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import { getAppSettings } from "./settings.service.js";
import { presentOptions, type CueCard } from "./questionContent.js";
import { createOptionIconViewUrl, issueAnswerVideoUrl, type AnswerVideoViewer } from "./upload.service.js";

/**
 * Flag lifecycle (PRD FR-2.2, FR-2.9, FR-7.3, FR-8.1, FR-9.9). A Submission
 * with an open flag sits in FLAG_REVIEW until an Admin confirms one flag
 * (terminal VOIDED + one free retake credit) or dismisses every open flag
 * (the Submission returns to where it was).
 */

export type FlagErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INVALID_LIFECYCLE"
  | "ALREADY_RESOLVED"
  | "VALIDATION_ERROR";

export class SubmissionFlagError extends Error {
  constructor(public readonly code: FlagErrorCode, message: string) {
    super(message);
    this.name = "SubmissionFlagError";
  }
}

const DEVICE_FLAG_TYPES: readonly SubmissionFlagType[] = ["TECHNICAL_FAILURE", "CAMERA_DROP"];
const MAX_TEXT = 1000;

function requiredText(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new SubmissionFlagError("VALIDATION_ERROR", `${field} is required`);
  if (text.length > MAX_TEXT) {
    throw new SubmissionFlagError("VALIDATION_ERROR", `${field} must be at most ${MAX_TEXT} characters`);
  }
  return text;
}

async function lockSubmission(tx: Prisma.TransactionClient, submissionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE`;
}

/**
 * Route a Submission whose recording is complete and has no open flag: pay,
 * or skip payment when payment is off or a free retake credit is redeemed
 * (an automatic system waiver, PRD FR-7.3). Returns true when the Submission
 * became Assignment-ready, so the caller assigns Examiners after commit.
 */
export async function routeRecordedSubmission(
  tx: Prisma.TransactionClient,
  submission: { id: string; studentId: string },
  paymentEnabled: boolean,
): Promise<boolean> {
  let paymentRequired = paymentEnabled;
  if (paymentEnabled) {
    // Oldest unredeemed credit of this student only: credits never transfer.
    const redeemed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "RetakeCredit"
         SET "redeemedSubmissionId" = ${submission.id}::uuid, "redeemedAt" = NOW()
       WHERE "id" = (
         SELECT "id" FROM "RetakeCredit"
          WHERE "studentId" = ${submission.studentId}::uuid AND "redeemedSubmissionId" IS NULL
          ORDER BY "createdAt", "id"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING "id"
    `;
    paymentRequired = redeemed.length === 0;
  }

  await tx.submission.update({
    where: { id: submission.id, retentionStatus: "RETAINED" },
    data: {
      paymentRequired,
      status: paymentRequired ? "AWAITING_PAYMENT" : "PAID",
      flagReturnStatus: null,
    },
  });
  return !paymentRequired;
}

/** Assign Examiners after commit; a failure stays retryable by an Admin. */
export async function assignAfterRouting(submissionId: string, context: string) {
  try {
    await assignExaminersToSubmission(submissionId);
  } catch (error) {
    console.error(`Automatic examiner assignment failed (${context}) for ${submissionId}:`, error);
  }
}

/**
 * The test client reports a camera/mic/connection failure while a slot was
 * recording (PRD FR-3.7, FR-4.3). The Submission keeps recording; completion
 * sends it to flag review before payment.
 */
export async function raiseDeviceFlag(
  submissionId: string,
  studentId: string,
  input: { type?: unknown; reason?: unknown; manifestEntryId?: unknown },
) {
  if (!DEVICE_FLAG_TYPES.includes(input.type as SubmissionFlagType)) {
    throw new SubmissionFlagError("VALIDATION_ERROR", "type must be TECHNICAL_FAILURE or CAMERA_DROP");
  }
  const reason = requiredText(input.reason, "reason");
  const manifestEntryId = typeof input.manifestEntryId === "string" ? input.manifestEntryId : null;

  return prisma.$transaction(async (tx) => {
    await lockSubmission(tx, submissionId);
    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: { studentId: true, status: true, retentionStatus: true },
    });
    if (!submission || submission.studentId !== studentId || submission.retentionStatus !== "RETAINED") {
      throw new SubmissionFlagError("NOT_FOUND", "Submission not found");
    }
    if (submission.status !== "IN_PROGRESS") {
      throw new SubmissionFlagError("INVALID_LIFECYCLE", "Submission is not in progress");
    }
    if (manifestEntryId) {
      const entry = await tx.manifestEntry.findFirst({
        where: { id: manifestEntryId, submissionId },
        select: { id: true },
      });
      if (!entry) throw new SubmissionFlagError("VALIDATION_ERROR", "manifestEntryId is not part of this Submission");
    }
    return tx.submissionFlag.create({
      data: {
        submissionId,
        type: input.type as SubmissionFlagType,
        source: "STUDENT_DEVICE",
        reason,
        manifestEntryId,
        raisedById: studentId,
      },
      select: { id: true, type: true, raisedAt: true },
    });
  });
}

/**
 * An assigned Examiner raises an integrity concern on an Answer (PRD FR-4.5).
 * Scoring pauses: the Submission enters FLAG_REVIEW and returns to SCORING if
 * the flag is dismissed.
 */
export async function raiseIntegrityConcern(
  assignmentId: string,
  examinerId: string,
  input: { answerId?: unknown; timestampSeconds?: unknown; note?: unknown },
) {
  const reason = requiredText(input.note, "note");
  const timestampSeconds =
    input.timestampSeconds === undefined || input.timestampSeconds === null
      ? null
      : Number(input.timestampSeconds);
  if (timestampSeconds !== null && (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0)) {
    throw new SubmissionFlagError("VALIDATION_ERROR", "timestampSeconds must be a non-negative integer");
  }
  if (typeof input.answerId !== "string") {
    throw new SubmissionFlagError("VALIDATION_ERROR", "answerId is required");
  }
  const answerId = input.answerId;

  const ref = await prisma.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: { submissionId: true },
  });
  if (!ref) throw new SubmissionFlagError("NOT_FOUND", "Assignment not found");

  return prisma.$transaction(async (tx) => {
    await lockSubmission(tx, ref.submissionId);
    const assignment = await tx.examinerAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        examinerId: true,
        status: true,
        submission: { select: { id: true, status: true, retentionStatus: true } },
      },
    });
    if (!assignment || assignment.submission.retentionStatus !== "RETAINED") {
      throw new SubmissionFlagError("NOT_FOUND", "Assignment not found");
    }
    if (assignment.examinerId !== examinerId) {
      throw new SubmissionFlagError("UNAUTHORIZED", "Unauthorized");
    }
    const { status } = assignment.submission;
    if (assignment.status === "COMPLETED" || (status !== "SCORING" && status !== "FLAG_REVIEW")) {
      throw new SubmissionFlagError("INVALID_LIFECYCLE", "Integrity concerns can only be raised while scoring");
    }
    const answer = await tx.answer.findFirst({
      where: { id: answerId, submissionId: ref.submissionId },
      select: { id: true, manifestEntryId: true },
    });
    if (!answer) throw new SubmissionFlagError("VALIDATION_ERROR", "answerId is not part of this Submission");

    const flag = await tx.submissionFlag.create({
      data: {
        submissionId: ref.submissionId,
        type: "INTEGRITY_CONCERN",
        source: "EXAMINER",
        reason,
        answerId: answer.id,
        manifestEntryId: answer.manifestEntryId,
        timestampSeconds,
        raisedById: examinerId,
      },
      select: { id: true, type: true, raisedAt: true },
    });
    if (status === "SCORING") {
      await tx.submission.update({
        where: { id: ref.submissionId },
        data: { status: "FLAG_REVIEW", flagReturnStatus: "SCORING" },
      });
    }
    return flag;
  });
}

/**
 * Open flags of Submissions awaiting an Admin decision, oldest first, with
 * evidence: every Answer of the Submission in slot order with its Delivered
 * prompt snapshot and an audited video URL (one per Answer per response).
 */
export async function listOpenFlags(viewer: AnswerVideoViewer) {
  const flags = await prisma.submissionFlag.findMany({
    where: {
      resolution: null,
      submission: { status: "FLAG_REVIEW", retentionStatus: "RETAINED" },
    },
    orderBy: [{ raisedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      submissionId: true,
      type: true,
      source: true,
      reason: true,
      answerId: true,
      manifestEntryId: true,
      timestampSeconds: true,
      raisedAt: true,
      raisedBy: { select: { username: true, role: true } },
      submission: {
        select: {
          createdAt: true,
          student: { select: { username: true, email: true } },
          manifest: { select: { entries: { select: { id: true, category: true } } } },
        },
      },
    },
  });

  const recorded = await prisma.answer.findMany({
    where: { submissionId: { in: [...new Set(flags.map((flag) => flag.submissionId))] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      submissionId: true,
      manifestEntryId: true,
      storageKey: true,
      bucket: true,
      mimeType: true,
      uploadStatus: true,
      manifestEntry: {
        select: {
          category: true,
          deliveryPosition: true,
          cueCard: true,
          options: true,
          tasks: { orderBy: { deliveredOrder: "asc" }, select: { id: true, deliveredOrder: true, deliveredText: true } },
        },
      },
      question: {
        select: { category: true, tasks: { orderBy: { order: "asc" }, select: { id: true, promptText: true, order: true } } },
      },
    },
  });
  // Slot order; Answers without a manifest entry keep recording order (stable sort).
  recorded.sort(
    (left, right) => (left.manifestEntry?.deliveryPosition ?? 0) - (right.manifestEntry?.deliveryPosition ?? 0),
  );

  // Each Answer is signed and audited once, under the Submission's oldest open flag.
  const answers = await Promise.all(
    recorded.map(async (answer) => ({
      submissionId: answer.submissionId,
      answerId: answer.id,
      manifestEntryId: answer.manifestEntryId,
      questionCategory: answer.manifestEntry?.category ?? answer.question?.category ?? null,
      deliveryPosition: answer.manifestEntry?.deliveryPosition ?? null,
      tasks: answer.manifestEntry
        ? answer.manifestEntry.tasks.map((task) => ({ id: task.id, promptText: task.deliveredText, order: task.deliveredOrder }))
        : answer.question?.tasks ?? [],
      cueCard: (answer.manifestEntry?.cueCard as CueCard | null | undefined) ?? null,
      options: await presentOptions(answer.manifestEntry?.options, createOptionIconViewUrl),
      videoUrl: await issueAnswerVideoUrl(answer, viewer, {
        context: "ADMIN_FLAG_REVIEW",
        flagId: flags.find((flag) => flag.submissionId === answer.submissionId)!.id,
      }),
    })),
  );

  return flags.map((flag) => {
    const submissionAnswers = answers
      .filter((answer) => answer.submissionId === flag.submissionId)
      .map(({ submissionId: _submissionId, ...answer }) => answer);
    // Evidence: the flagged Answer, else the Answer recorded for the flagged slot.
    const evidence =
      submissionAnswers.find((answer) => answer.answerId === flag.answerId) ??
      submissionAnswers.find((answer) => flag.manifestEntryId && answer.manifestEntryId === flag.manifestEntryId) ??
      null;
    return {
      id: flag.id,
      submissionId: flag.submissionId,
      type: flag.type,
      source: flag.source,
      reason: flag.reason,
      answerId: flag.answerId,
      manifestEntryId: flag.manifestEntryId,
      timestampSeconds: flag.timestampSeconds,
      raisedAt: flag.raisedAt,
      raisedBy: flag.raisedBy?.username ?? null,
      slot:
        flag.submission.manifest?.entries.find((entry) => entry.id === flag.manifestEntryId)?.category ?? null,
      studentName: flag.submission.student.username,
      studentEmail: flag.submission.student.email,
      submissionCreatedAt: flag.submission.createdAt,
      videoUrl: evidence?.videoUrl ?? null,
      answers: submissionAnswers,
    };
  });
}

async function lockOpenFlag(tx: Prisma.TransactionClient, flagId: string) {
  const ref = await tx.submissionFlag.findUnique({ where: { id: flagId }, select: { submissionId: true } });
  if (!ref) throw new SubmissionFlagError("NOT_FOUND", "Flag not found");
  await lockSubmission(tx, ref.submissionId);
  const flag = await tx.submissionFlag.findUniqueOrThrow({
    where: { id: flagId },
    select: {
      resolution: true,
      submission: {
        select: { id: true, studentId: true, status: true, retentionStatus: true, flagReturnStatus: true },
      },
    },
  });
  if (flag.resolution) throw new SubmissionFlagError("ALREADY_RESOLVED", "Flag is already resolved");
  if (flag.submission.retentionStatus !== "RETAINED" || flag.submission.status !== "FLAG_REVIEW") {
    throw new SubmissionFlagError("INVALID_LIFECYCLE", "Submission is not in flag review");
  }
  return flag.submission;
}

async function assertActiveAdmin(tx: Prisma.TransactionClient, adminId: string) {
  const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, deletedAt: true } });
  if (!admin || admin.role !== "ADMIN" || admin.deletedAt) {
    throw new SubmissionFlagError("UNAUTHORIZED", "Only an active administrator can resolve flags");
  }
}

/**
 * Confirm a flag: the Submission becomes terminal VOIDED, is never scored, and
 * its student receives exactly one free retake credit (PRD FR-2.9).
 */
export async function confirmFlag(flagId: string, adminId: string, note: unknown) {
  const resolutionNote = requiredText(note, "note");
  return prisma.$transaction(async (tx) => {
    await assertActiveAdmin(tx, adminId);
    const submission = await lockOpenFlag(tx, flagId);
    const now = new Date();
    await tx.submissionFlag.update({
      where: { id: flagId },
      data: { resolution: "CONFIRMED", resolutionNote, resolvedById: adminId, resolvedAt: now },
    });
    await tx.submissionFlag.updateMany({
      where: { submissionId: submission.id, resolution: null },
      data: {
        resolution: "SUPERSEDED",
        resolutionNote: `Superseded by confirmed flag ${flagId}`,
        resolvedById: adminId,
        resolvedAt: now,
      },
    });
    await tx.submission.update({
      where: { id: submission.id },
      data: { status: "VOIDED", flagReturnStatus: null },
    });
    // voidedSubmissionId is unique: one credit per voided Submission.
    const credit = await tx.retakeCredit.create({
      data: { studentId: submission.studentId, voidedSubmissionId: submission.id },
      select: { id: true },
    });
    return { submissionId: submission.id, status: "VOIDED" as SubmissionStatus, retakeCreditId: credit.id };
  });
}

/**
 * Dismiss a flag as a false alarm. Once no open flag remains the Submission
 * returns to where it was: SCORING for an Examiner concern, or the normal
 * payment/waiver route for a flag raised during the test.
 */
export async function dismissFlag(flagId: string, adminId: string, note: unknown) {
  const resolutionNote = requiredText(note, "note");
  const { paymentEnabled } = await getAppSettings();
  const outcome = await prisma.$transaction(async (tx) => {
    await assertActiveAdmin(tx, adminId);
    const submission = await lockOpenFlag(tx, flagId);
    await tx.submissionFlag.update({
      where: { id: flagId },
      data: { resolution: "DISMISSED", resolutionNote, resolvedById: adminId, resolvedAt: new Date() },
    });
    const stillOpen = await tx.submissionFlag.count({
      where: { submissionId: submission.id, resolution: null },
    });
    if (stillOpen > 0) {
      return { submissionId: submission.id, status: "FLAG_REVIEW" as SubmissionStatus, assign: false };
    }
    if (submission.flagReturnStatus) {
      await tx.submission.update({
        where: { id: submission.id },
        data: { status: submission.flagReturnStatus, flagReturnStatus: null },
      });
      return { submissionId: submission.id, status: submission.flagReturnStatus, assign: false };
    }
    const assign = await routeRecordedSubmission(tx, submission, paymentEnabled);
    return {
      submissionId: submission.id,
      status: (assign ? "PAID" : "AWAITING_PAYMENT") as SubmissionStatus,
      assign,
    };
  });

  if (outcome.assign) await assignAfterRouting(outcome.submissionId, "flag dismissed");
  return { submissionId: outcome.submissionId, status: outcome.status };
}

/** Student-facing void details and credit availability. */
export async function readVoidDetails(submissionId: string) {
  const [flag, credit] = await Promise.all([
    prisma.submissionFlag.findFirst({
      where: { submissionId, resolution: "CONFIRMED" },
      select: { type: true, resolutionNote: true },
    }),
    prisma.retakeCredit.findUnique({
      where: { voidedSubmissionId: submissionId },
      select: { redeemedSubmissionId: true },
    }),
  ]);
  return {
    voidReason: flag?.resolutionNote ?? null,
    voidFlagType: flag?.type ?? null,
    retakeCreditAvailable: credit ? credit.redeemedSubmissionId === null : false,
  };
}

export async function hasUnredeemedRetakeCredit(studentId: string) {
  const count = await prisma.retakeCredit.count({ where: { studentId, redeemedSubmissionId: null } });
  return count > 0;
}
