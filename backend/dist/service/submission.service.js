import { prisma } from "../config/db.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import { getAppSettings } from "./settings.service.js";
import { createPresignedViewUrl, createQuestionAudioViewUrl } from "./upload.service.js";
/**
 * Create a new submission for the authenticated student.
 * Status starts as IN_PROGRESS.
 */
export async function createSubmission(userId) {
    const submission = await prisma.submission.create({
        data: {
            studentId: userId,
            status: "IN_PROGRESS",
        },
        select: {
            id: true,
            status: true,
            createdAt: true,
        },
    });
    return submission;
}
/**
 * Fetch dashboard stats and submission history for the authenticated student.
 */
export async function getStudentDashboard(userId) {
    const submissions = await prisma.submission.findMany({
        where: {
            studentId: userId,
            status: { not: "IN_PROGRESS" },
        },
        orderBy: { createdAt: "desc" },
        include: {
            certificate: {
                select: { finalScore: true },
            },
            answers: {
                include: {
                    scores: {
                        select: { value: true },
                    },
                },
            },
        },
    });
    const scores = submissions
        .map((s) => s.certificate?.finalScore)
        .flatMap((s) => (s != null ? [Number(s)] : []));
    const totalTests = submissions.length;
    const bestScore = scores.length > 0
        ? Math.max(...scores.map((s) => Number(s)))
        : null;
    return {
        totalTests,
        bestScore,
        submissions: submissions.map((s) => {
            let dynamicScore = null;
            if (!s.certificate && (s.status === "SCORED" || s.status === "CERTIFIED")) {
                const answerScores = s.answers.flatMap((a) => a.scores.length > 0 ? [a.scores.reduce((sum, sc) => sum + Number(sc.value), 0) / a.scores.length] : []);
                if (answerScores.length === s.answers.length && answerScores.length > 0) {
                    const overall = answerScores.reduce((sum, v) => sum + v, 0) / answerScores.length;
                    dynamicScore = overall.toFixed(2);
                }
            }
            return {
                id: s.id,
                status: s.status,
                score: s.certificate?.finalScore?.toString() ?? dynamicScore,
                createdAt: s.createdAt,
            };
        }),
    };
}
/**
 * Fetch a single submission with its answers and presigned video URLs.
 */
export async function getSubmissionDetail(submissionId, userId) {
    const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
            certificate: {
                select: { finalScore: true },
            },
            answers: {
                include: {
                    question: {
                        select: { category: true, audioUploadStatus: true },
                    },
                    scores: {
                        select: { value: true, comment: true },
                    },
                },
                orderBy: { createdAt: "asc" },
            },
        },
    });
    if (!submission) {
        throw new Error("Submission not found");
    }
    if (submission.studentId !== userId) {
        throw new Error("Unauthorized");
    }
    const answers = await Promise.all(submission.answers.map(async (answer) => {
        let videoUrl = null;
        if (answer.uploadStatus === "UPLOADED") {
            try {
                videoUrl = await createPresignedViewUrl(submissionId, answer.questionId, userId);
            }
            catch {
                // If presigned URL generation fails, return null
                videoUrl = null;
            }
        }
        let audioUrl = null;
        if (answer.question.audioUploadStatus === "UPLOADED") {
            try {
                audioUrl = await createQuestionAudioViewUrl(answer.questionId);
            }
            catch {
                // If presigned URL generation fails, return null
                audioUrl = null;
            }
        }
        const scores = answer.scores.map((score) => Number(score.value));
        const score = scores.length > 0
            ? scores.reduce((total, value) => total + value, 0) / scores.length
            : null;
        const comments = answer.scores.flatMap(({ comment }) => {
            const trimmed = comment?.trim();
            return trimmed ? [trimmed] : [];
        });
        return {
            id: answer.id,
            questionId: answer.questionId,
            questionCategory: answer.question.category,
            audioUrl,
            durationSeconds: answer.durationSeconds,
            videoUrl,
            score: score == null ? null : Number(score.toFixed(2)),
            comments,
        };
    }));
    const scoredAnswers = answers.flatMap((answer) => answer.score == null ? [] : [answer.score]);
    const calculatedOverallScore = (submission.status === "SCORED" || submission.status === "CERTIFIED") &&
        answers.length > 0 &&
        scoredAnswers.length === answers.length
        ? scoredAnswers.reduce((total, value) => total + value, 0) / scoredAnswers.length
        : null;
    return {
        id: submission.id,
        status: submission.status,
        score: submission.certificate?.finalScore?.toString() ??
            (calculatedOverallScore == null ? null : calculatedOverallScore.toFixed(2)),
        createdAt: submission.createdAt,
        answers,
    };
}
/**
 * Mark a submission as complete when all answers have been uploaded.
 * Requires payment or starts examiner assignment based on the current app setting.
 * Only the student who owns the submission can complete it.
 */
export async function completeSubmission(submissionId, userId) {
    // Verify the submission belongs to this user and is still IN_PROGRESS
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
    if (submission.status !== "IN_PROGRESS") {
        throw new Error("Submission is not in progress");
    }
    // Count all answers and check all are uploaded
    const [totalAnswers, uploadedAnswers] = await Promise.all([
        prisma.answer.count({
            where: { submissionId },
        }),
        prisma.answer.count({
            where: { submissionId, uploadStatus: "UPLOADED" },
        }),
    ]);
    if (totalAnswers === 0) {
        throw new Error("No answers recorded");
    }
    if (uploadedAnswers < totalAnswers) {
        throw new Error(`Not all answers uploaded yet (${uploadedAnswers}/${totalAnswers})`);
    }
    const { paymentEnabled } = await getAppSettings();
    const paymentRequired = paymentEnabled;
    const transition = await prisma.submission.updateMany({
        where: { id: submissionId, status: "IN_PROGRESS" },
        data: {
            paymentRequired,
            status: paymentRequired ? "AWAITING_PAYMENT" : "PAID",
        },
    });
    if (transition.count === 0) {
        throw new Error("Submission is not in progress");
    }
    if (!paymentRequired) {
        try {
            await assignExaminersToSubmission(submissionId);
        }
        catch (error) {
            // Completion must remain successful even when assignment has to be retried by an admin.
            console.error(`Automatic examiner assignment failed for waived submission ${submissionId}:`, error);
        }
    }
}
