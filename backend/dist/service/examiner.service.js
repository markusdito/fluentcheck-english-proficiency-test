import { prisma } from "../config/db.js";
import { createPresignedViewUrlForAccessor } from "./upload.service.js";
/**
 * List all assignments for the examiner, ordered by newest first.
 */
export async function getExaminerAssignments(examinerId) {
    const assignments = await prisma.examinerAssignment.findMany({
        where: { examinerId },
        orderBy: { createdAt: "desc" },
        include: {
            submission: {
                select: {
                    id: true,
                    status: true,
                    student: {
                        select: { username: true },
                    },
                },
            },
        },
    });
    return assignments.map((a) => ({
        id: a.id,
        status: a.status,
        submissionId: a.submissionId,
        studentName: a.submission.student.username,
        submissionStatus: a.submission.status,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
    }));
}
/**
 * Get a single assignment with all answers and presigned video URLs.
 * Only the assigned examiner can view this.
 */
export async function getExaminerAssignmentDetail(assignmentId, examinerId) {
    const assignment = await prisma.examinerAssignment.findUnique({
        where: { id: assignmentId },
        include: {
            submission: {
                include: {
                    student: {
                        select: { username: true },
                    },
                    answers: {
                        include: {
                            question: {
                                select: {
                                    category: true,
                                    promptText: true,
                                    tasks: {
                                        select: { id: true, promptText: true, order: true },
                                        orderBy: { order: "asc" },
                                    },
                                },
                            },
                        },
                        orderBy: { createdAt: "asc" },
                    },
                    assignments: {
                        include: {
                            examiner: {
                                select: { id: true, username: true },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!assignment) {
        throw new Error("Assignment not found");
    }
    if (assignment.examinerId !== examinerId) {
        throw new Error("Unauthorized");
    }
    const answers = await Promise.all(assignment.submission.answers.map(async (answer) => {
        let videoUrl = null;
        if (answer.uploadStatus === "UPLOADED") {
            try {
                videoUrl = await createPresignedViewUrlForAccessor(assignment.submissionId, answer.questionId);
            }
            catch {
                videoUrl = null;
            }
        }
        return {
            id: answer.id,
            questionId: answer.questionId,
            questionCategory: answer.question.category,
            promptText: answer.question.promptText,
            tasks: answer.question.tasks,
            durationSeconds: answer.durationSeconds,
            videoUrl,
        };
    }));
    return {
        id: assignment.id,
        status: assignment.status,
        submissionId: assignment.submissionId,
        studentName: assignment.submission.student.username,
        submissionStatus: assignment.submission.status,
        answers,
        examiners: assignment.submission.assignments.map((a) => ({
            id: a.examiner.id,
            name: a.examiner.username,
            status: a.status,
        })),
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
    };
}
/**
 * Assign examiners to a submission.
 * - 1 examiner available → assign that one
 * - 2+ examiners available → randomly pick 2
 * - 0 examiners → throw error
 * Transitions submission from PAID to SCORING when at least one examiner is assigned.
 */
export async function assignExaminersToSubmission(submissionId) {
    const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true },
    });
    if (!submission) {
        throw new Error("Submission not found");
    }
    if (submission.status !== "PAID") {
        throw new Error("Submission must be in PAID status");
    }
    const examiners = await prisma.user.findMany({
        where: { role: "EXAMINER" },
        select: { id: true, username: true, email: true },
    });
    if (examiners.length === 0) {
        throw new Error("No examiners available. Create an examiner user first.");
    }
    const shuffled = [...examiners].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(2, shuffled.length));
    await prisma.$transaction(async (tx) => {
        for (const examiner of selected) {
            await tx.examinerAssignment.create({
                data: {
                    submissionId,
                    examinerId: examiner.id,
                    status: "ASSIGNED",
                },
            });
        }
        await tx.submission.update({
            where: { id: submissionId },
            data: { status: "SCORING" },
        });
    });
    return selected.map((e) => ({
        id: e.id,
        name: e.username,
        email: e.email,
    }));
}
/**
 * Mark an assignment as IN_PROGRESS.
 */
export async function startExaminerAssignment(assignmentId, examinerId) {
    const assignment = await prisma.examinerAssignment.findUnique({
        where: { id: assignmentId },
        select: { examinerId: true, status: true },
    });
    if (!assignment) {
        throw new Error("Assignment not found");
    }
    if (assignment.examinerId !== examinerId) {
        throw new Error("Unauthorized");
    }
    if (assignment.status !== "ASSIGNED") {
        throw new Error("Assignment is not in ASSIGNED status");
    }
    await prisma.examinerAssignment.update({
        where: { id: assignmentId },
        data: { status: "IN_PROGRESS" },
    });
}
/**
 * Submit scores for all answers in an assignment.
 * After submission, check if both examiners have completed → transition submission to SCORED.
 */
export async function submitExaminerScores(assignmentId, examinerId, scores) {
    const assignment = await prisma.examinerAssignment.findUnique({
        where: { id: assignmentId },
        select: { examinerId: true, status: true, submissionId: true },
    });
    if (!assignment) {
        throw new Error("Assignment not found");
    }
    if (assignment.examinerId !== examinerId) {
        throw new Error("Unauthorized");
    }
    if (assignment.status !== "ASSIGNED" && assignment.status !== "IN_PROGRESS") {
        throw new Error("Assignment is already completed");
    }
    // Validate and create scores in a transaction
    await prisma.$transaction(async (tx) => {
        for (const score of scores) {
            if (score.value < 0 || score.value > 100) {
                throw new Error(`Score value must be between 0 and 100 (got ${score.value})`);
            }
            await tx.score.upsert({
                where: {
                    assignmentId_answerId: {
                        assignmentId,
                        answerId: score.answerId,
                    },
                },
                update: {
                    value: score.value,
                    comment: score.comment,
                },
                create: {
                    assignmentId,
                    answerId: score.answerId,
                    value: score.value,
                    comment: score.comment,
                },
            });
        }
        // Mark assignment as COMPLETED
        await tx.examinerAssignment.update({
            where: { id: assignmentId },
            data: { status: "COMPLETED" },
        });
    });
    // Check if both examiners have completed → transition submission to SCORED
    const otherAssignments = await prisma.examinerAssignment.findMany({
        where: {
            submissionId: assignment.submissionId,
            id: { not: assignmentId },
        },
        select: { status: true },
    });
    const allCompleted = otherAssignments.every((a) => a.status === "COMPLETED");
    if (allCompleted) {
        await prisma.submission.update({
            where: { id: assignment.submissionId },
            data: { status: "SCORED" },
        });
    }
    else {
        // If this is the first to complete, ensure submission is in SCORING status
        await prisma.submission.update({
            where: { id: assignment.submissionId },
            data: { status: "SCORING" },
        });
    }
}
