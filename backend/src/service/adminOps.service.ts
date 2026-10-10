import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import type { SubmissionStatus } from "../generated/enums.js";
import { ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY, isContention } from "./accountTransition.service.js";
import { assignAfterRouting } from "./submissionFlag.service.js";

/**
 * Admin operations outside the role-transition flow (PRD §4.3, FR-7.3,
 * FR-8.3, FR-10.1): waive payment for one Submission, reassign one untouched
 * Examiner assignment, and read the review queues.
 */

export type AdminOpsErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INVALID_LIFECYCLE"
  | "NOT_REASSIGNABLE"
  | "INVALID_EXAMINER"
  | "VALIDATION_ERROR"
  | "CONFLICT";

export class AdminOpsError extends Error {
  constructor(public readonly code: AdminOpsErrorCode, message: string) {
    super(message);
    this.name = "AdminOpsError";
  }
}

const MAX_TEXT = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASSIGNMENT_TRANSACTION_ATTEMPTS = 3;
// Statuses in which a Submission's assignment set is open scoring work.
const REASSIGNABLE_SUBMISSION_STATUSES: readonly SubmissionStatus[] = ["SCORING", "FLAG_REVIEW"];
// A checkout with no provider outcome after this long needs a human look.
export const PAYMENT_OUTCOME_GRACE_MS = 60 * 60 * 1000;
const QUEUE_LIMIT = 50;

/** PRD FR-8.3: only untouched ASSIGNED work of a Submission in scoring moves. */
export function isReassignable(submissionStatus: SubmissionStatus, assignmentStatus: string, scoreCount: number) {
  return (
    REASSIGNABLE_SUBMISSION_STATUSES.includes(submissionStatus) &&
    assignmentStatus === "ASSIGNED" &&
    scoreCount === 0
  );
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new AdminOpsError("VALIDATION_ERROR", `${field} is required`);
  if (text.length > MAX_TEXT) {
    throw new AdminOpsError("VALIDATION_ERROR", `${field} must be at most ${MAX_TEXT} characters`);
  }
  return text;
}

async function assertActiveAdmin(tx: Prisma.TransactionClient, adminId: string) {
  const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, deletedAt: true } });
  if (!admin || admin.role !== "ADMIN" || admin.deletedAt) {
    throw new AdminOpsError("UNAUTHORIZED", "Only an active administrator can do this");
  }
}

/**
 * Waive payment for one Submission awaiting payment (PRD FR-7.3). The
 * Submission becomes Assignment-ready and Examiners are assigned after
 * commit; an assignment failure leaves it in the assignment-ready queue.
 */
export async function waiveSubmissionPayment(submissionId: string, adminId: string, reasonInput: unknown) {
  const reason = requiredText(reasonInput, "reason");

  const waiver = await prisma.$transaction(async (tx) => {
    await assertActiveAdmin(tx, adminId);
    // Checkout, callbacks and purge approval take the same row lock.
    await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE`;
    const submission = await tx.submission.findUnique({
      where: { id: submissionId },
      select: { status: true, retentionStatus: true },
    });
    if (!submission || submission.retentionStatus !== "RETAINED") {
      throw new AdminOpsError("NOT_FOUND", "Submission not found");
    }
    if (submission.status !== "AWAITING_PAYMENT") {
      throw new AdminOpsError("INVALID_LIFECYCLE", "Only a Submission awaiting payment can be waived");
    }
    const created = await tx.submissionPaymentWaiver.create({
      data: { submissionId, adminId, reason },
      select: { id: true, reason: true, createdAt: true },
    });
    await tx.submission.update({
      where: { id: submissionId },
      data: { paymentRequired: false, status: "PAID" },
    });
    return created;
  });

  await assignAfterRouting(submissionId, "payment waived");
  const { status } = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { status: true },
  });
  return { submissionId, status, waiver };
}

export interface ReassignmentResult {
  assignmentId: string;
  submissionId: string;
  outcome: "REASSIGNED" | "ALREADY_APPLIED";
  previousExaminerId: string;
  examinerId: string;
}

/**
 * Move one untouched ASSIGNED assignment to another Eligible examiner (PRD
 * FR-8.3). The assignment keeps its identity and slot; every move is kept in
 * the reassignment history. Work an Examiner has started stays with them.
 */
export async function reassignExaminerAssignment(
  assignmentId: string,
  adminId: string,
  input: { examinerId?: unknown; reason?: unknown },
): Promise<ReassignmentResult> {
  const note = requiredText(input.reason, "reason");
  const examinerId = input.examinerId;
  if (typeof examinerId !== "string" || !UUID_RE.test(examinerId)) {
    throw new AdminOpsError("VALIDATION_ERROR", "A valid examinerId is required");
  }

  for (let attempt = 1; attempt <= REASSIGNMENT_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => reassignInsideTransaction(tx, assignmentId, adminId, examinerId, note),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isContention(error)) throw error;
    }
  }
  throw new AdminOpsError("CONFLICT", "The assignment changed concurrently; retry the request");
}

async function reassignInsideTransaction(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  adminId: string,
  examinerId: string,
  note: string,
): Promise<ReassignmentResult> {
  // Same boundary and lock order as account transitions and assignment-set
  // creation: advisory lock, users, Submission, assignment.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCOUNT_TRANSITION_ADVISORY_LOCK_KEY})`;

  const ref = await tx.examinerAssignment.findUnique({
    where: { id: assignmentId },
    select: { submissionId: true, examinerId: true },
  });
  if (!ref) throw new AdminOpsError("NOT_FOUND", "Assignment not found");

  for (const id of [...new Set([adminId, ref.examinerId, examinerId])].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${ref.submissionId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "ExaminerAssignment" WHERE "id" = ${assignmentId}::uuid FOR UPDATE`;

  await assertActiveAdmin(tx, adminId);
  const assignment = await tx.examinerAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    select: {
      examinerId: true,
      status: true,
      _count: { select: { scores: true } },
      submission: {
        select: {
          status: true,
          retentionStatus: true,
          assignments: { select: { id: true, examinerId: true } },
        },
      },
    },
  });
  if (assignment.examinerId !== ref.examinerId) {
    throw new AdminOpsError("CONFLICT", "The assignment changed concurrently; retry the request");
  }
  if (assignment.submission.retentionStatus !== "RETAINED") {
    throw new AdminOpsError("NOT_FOUND", "Assignment not found");
  }

  const result = {
    assignmentId,
    submissionId: ref.submissionId,
    previousExaminerId: assignment.examinerId,
    examinerId,
  };
  if (assignment.examinerId === examinerId) return { ...result, outcome: "ALREADY_APPLIED" };

  if (!isReassignable(assignment.submission.status, assignment.status, assignment._count.scores)) {
    throw new AdminOpsError(
      "NOT_REASSIGNABLE",
      "Only an untouched ASSIGNED assignment of a Submission in scoring can be reassigned",
    );
  }

  const replacement = await tx.user.findUnique({
    where: { id: examinerId },
    select: { role: true, deletedAt: true },
  });
  const takenBy = assignment.submission.assignments.some(
    (other) => other.id !== assignmentId && other.examinerId === examinerId,
  );
  if (!replacement || replacement.role !== "EXAMINER" || replacement.deletedAt || takenBy) {
    throw new AdminOpsError(
      "INVALID_EXAMINER",
      "The new examiner must be an active Examiner not already assigned to this Submission",
    );
  }

  await tx.examinerAssignment.update({ where: { id: assignmentId }, data: { examinerId } });
  await tx.examinerAssignmentReassignment.create({
    data: {
      transitionId: crypto.randomUUID(),
      assignmentId,
      previousExaminerId: assignment.examinerId,
      newExaminerId: examinerId,
      actingAdminId: adminId,
      reason: "ADMIN_REASSIGNMENT",
      note,
    },
  });
  return { ...result, outcome: "REASSIGNED" };
}

export type PaymentReconciliationReason =
  | "CHECKOUT_UNCONFIRMED" // the provider never confirmed a checkout session
  | "NO_PROVIDER_OUTCOME" // a checkout session exists but no final notification arrived
  | "DUPLICATE_PAYMENT" // more than one paid attempt for the same Submission
  | "PAID_WHILE_WAIVED"; // a paid attempt for a Submission that did not need payment

const reconciliationSelect = {
  id: true,
  submissionId: true,
  status: true,
  amount: true,
  currency: true,
  merchantReference: true,
  providerSessionId: true,
  providerTransactionId: true,
  createdAt: true,
  paidAt: true,
  submission: { select: { status: true, student: { select: { username: true } } } },
} satisfies Prisma.PaymentSelect;

type ReconciliationPayment = Prisma.PaymentGetPayload<{ select: typeof reconciliationSelect }>;

/**
 * Payment attempts whose provider outcome is ambiguous and needs an Admin
 * decision (PRD FR-7.2). Nothing here is resolved automatically.
 */
async function paymentReconciliationQueue(now: Date) {
  const retained = { retentionStatus: "RETAINED" } as const;
  const [stale, duplicates, waivedPaid] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: new Date(now.getTime() - PAYMENT_OUTCOME_GRACE_MS) },
        submission: retained,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: reconciliationSelect,
    }),
    prisma.payment.groupBy({
      by: ["submissionId"],
      where: { status: "PAID", submission: retained },
      having: { id: { _count: { gt: 1 } } },
      orderBy: { submissionId: "asc" },
      take: QUEUE_LIMIT,
    }),
    prisma.payment.findMany({
      where: { status: "PAID", submission: { ...retained, paymentRequired: false } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: reconciliationSelect,
    }),
  ]);
  const duplicatePayments = duplicates.length
    ? await prisma.payment.findMany({
        where: { status: "PAID", submissionId: { in: duplicates.map((row) => row.submissionId) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: reconciliationSelect,
      })
    : [];

  const tagged: { reason: PaymentReconciliationReason; payment: ReconciliationPayment }[] = [
    ...stale.map((payment) => ({
      reason: (payment.providerSessionId ? "NO_PROVIDER_OUTCOME" : "CHECKOUT_UNCONFIRMED") as PaymentReconciliationReason,
      payment,
    })),
    ...duplicatePayments.map((payment) => ({ reason: "DUPLICATE_PAYMENT" as const, payment })),
    ...waivedPaid.map((payment) => ({ reason: "PAID_WHILE_WAIVED" as const, payment })),
  ];
  tagged.sort((a, b) => a.payment.createdAt.getTime() - b.payment.createdAt.getTime());

  return {
    total: tagged.length,
    items: tagged.slice(0, QUEUE_LIMIT).map(({ reason, payment }) => ({
      reason,
      paymentId: payment.id,
      submissionId: payment.submissionId,
      submissionStatus: payment.submission.status,
      studentName: payment.submission.student.username,
      paymentStatus: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      merchantReference: payment.merchantReference,
      providerSessionId: payment.providerSessionId,
      providerTransactionId: payment.providerTransactionId,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
    })),
  };
}

/**
 * Dashboard review queues (PRD FR-10.1): open flags awaiting a decision,
 * ambiguous payment outcomes, and Assignment-ready Submissions that have no
 * Examiners yet. Each queue lists its oldest items first.
 */
export async function getAdminQueues(now = new Date()) {
  const openFlagWhere = {
    resolution: null,
    submission: { status: "FLAG_REVIEW", retentionStatus: "RETAINED" },
  } satisfies Prisma.SubmissionFlagWhereInput;
  // Assignment-ready = recording complete, no open flag, payment satisfied
  // or waived, and no assignment yet (PRD FR-8.1).
  const assignmentReadyWhere = {
    status: "PAID",
    retentionStatus: "RETAINED",
    assignments: { none: {} },
    flags: { none: { resolution: null } },
  } satisfies Prisma.SubmissionWhereInput;

  const [flagTotal, flags, readyTotal, ready, paymentReconciliation] = await Promise.all([
    prisma.submissionFlag.count({ where: openFlagWhere }),
    prisma.submissionFlag.findMany({
      where: openFlagWhere,
      orderBy: [{ raisedAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        submissionId: true,
        type: true,
        source: true,
        reason: true,
        raisedAt: true,
        submission: { select: { student: { select: { username: true } } } },
      },
    }),
    prisma.submission.count({ where: assignmentReadyWhere }),
    prisma.submission.findMany({
      where: assignmentReadyWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        paymentRequired: true,
        createdAt: true,
        updatedAt: true,
        student: { select: { username: true } },
        paymentWaiver: { select: { id: true } },
      },
    }),
    paymentReconciliationQueue(now),
  ]);

  return {
    openFlags: {
      total: flagTotal,
      items: flags.map((flag) => ({
        id: flag.id,
        submissionId: flag.submissionId,
        type: flag.type,
        source: flag.source,
        reason: flag.reason,
        raisedAt: flag.raisedAt,
        studentName: flag.submission.student.username,
      })),
    },
    paymentReconciliation,
    assignmentReady: {
      total: readyTotal,
      items: ready.map((submission) => ({
        submissionId: submission.id,
        studentName: submission.student.username,
        paymentWaived: submission.paymentWaiver !== null,
        paymentRequired: submission.paymentRequired,
        createdAt: submission.createdAt,
        readySince: submission.updatedAt,
      })),
    },
  };
}
