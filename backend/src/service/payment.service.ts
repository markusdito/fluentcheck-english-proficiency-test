import { prisma } from "../config/db.js";
import { assignExaminersToSubmission } from "./examiner.service.js";

export async function confirmPayment(
  submissionId: string,
  userId: string,
  metadata?: { amount?: number; currency?: string; provider?: string; providerRef?: string }
): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true, status: true },
  });

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (submission.studentId !== userId) {
    throw new Error("Unauthorized");
  }

  if (submission.status !== "AWAITING_PAYMENT") {
    throw new Error("Submission is not awaiting payment");
  }

  await prisma.$transaction(async (tx) => {
    // Create payment record
    await tx.payment.create({
      data: {
        submissionId,
        amount: metadata?.amount ?? 0,
        currency: metadata?.currency ?? "IDR",
        provider: metadata?.provider,
        providerRef: metadata?.providerRef,
        status: "PAID",
        paidAt: new Date(),
      },
    });

    // Transition submission to PAID
    await tx.submission.update({
      where: { id: submissionId },
      data: { status: "PAID" },
    });
  });

  // Auto-assign examiners (picks 1-2 randomly, transitions to SCORING)
  await assignExaminersToSubmission(submissionId);
}