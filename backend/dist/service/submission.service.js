import { prisma } from "../config/db.js";
import { assignExaminersToSubmission } from "./examiner.service.js";
import { getAppSettings } from "./settings.service.js";
import { assertLegacyAnswerQuestion, assertLegacySubmissionEvidence, } from "./submissionManifest.service.js";
import { createQuestionAudioViewUrlFromMetadata, createVideoViewUrlFromMetadata, } from "./upload.service.js";
import { aggregateStoredScores, average, averageRubrics, roundScore, } from "../utils/scoring.js";
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
/** Explicitly abandon an in-progress attempt; the transition is terminal and idempotent. */
export async function abandonSubmission(submissionId, userId) {
    const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { id: true, studentId: true, status: true },
    });
    if (!submission)
        throw new Error("Submission not found");
    if (submission.studentId !== userId)
        throw new Error("Unauthorized");
    if (submission.status === "ABANDONED")
        return submission;
    if (submission.status !== "IN_PROGRESS")
        throw new Error("Submission is not in progress");
    await prisma.submission.updateMany({
        where: { id: submissionId, studentId: userId, status: "IN_PROGRESS" },
        data: { status: "ABANDONED" },
    });
    return prisma.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { id: true, studentId: true, status: true },
    });
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
                        select: {
                            value: true,
                            pronunciation: true,
                            fluency: true,
                            vocabulary: true,
                            grammar: true,
                        },
                    },
                },
            },
        },
    });
    const certificateScores = submissions.flatMap((submission) => submission.certificate
        ? [{
                value: Number(submission.certificate.finalScore),
                scoringSystem: submission.scoringSystem,
            }]
        : []);
    const rubricCertificateScores = certificateScores.filter((score) => score.scoringSystem === "RUBRIC_6");
    const preferredScores = rubricCertificateScores.length > 0
        ? rubricCertificateScores
        : certificateScores.filter((score) => score.scoringSystem === "LEGACY_100");
    const totalTests = submissions.length;
    const bestScore = preferredScores.length > 0
        ? preferredScores.reduce((best, score) => score.value > best.value ? score : best)
        : null;
    return {
        totalTests,
        bestScore,
        submissions: submissions.map((s) => {
            let dynamicScore = null;
            if (!s.certificate && (s.status === "SCORED" || s.status === "CERTIFIED")) {
                const answerScores = s.answers.flatMap((a) => a.scores.length > 0
                    ? [average(a.scores.map((score) => Number(score.value)))]
                    : []);
                if (answerScores.length === s.answers.length && answerScores.length > 0) {
                    dynamicScore = average(answerScores).toFixed(2);
                }
            }
            return {
                id: s.id,
                status: s.status,
                score: s.certificate?.finalScore?.toString() ?? dynamicScore,
                scoringSystem: s.scoringSystem,
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
            manifest: {
                select: {
                    id: true,
                    version: true,
                    entries: {
                        select: {
                            id: true,
                            category: true,
                            preparationSeconds: true,
                            recordingSeconds: true,
                            promptMediaStorageKey: true,
                            promptMediaMimeType: true,
                            tasks: { orderBy: { deliveredOrder: "asc" }, select: { deliveredOrder: true, deliveredText: true } },
                        },
                    },
                },
            },
            certificate: {
                select: { finalScore: true },
            },
            answers: {
                include: {
                    question: {
                        select: {
                            category: true,
                            audioUploadStatus: true,
                            audioStorageKey: true,
                            audioMimeType: true,
                        },
                    },
                    scores: {
                        select: {
                            value: true,
                            pronunciation: true,
                            fluency: true,
                            vocabulary: true,
                            grammar: true,
                            comment: true,
                        },
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
    if (submission.manifest && submission.manifest.version !== 1) {
        throw new Error("Unsupported manifest version");
    }
    if (!submission.manifest)
        assertLegacySubmissionEvidence(submission.manifest);
    const answers = await Promise.all(submission.answers.map(async (answer) => {
        const manifestEntry = submission.manifest?.entries.find((entry) => entry.id === answer.manifestEntryId);
        if (submission.manifest && !manifestEntry) {
            throw new Error("Manifest evidence unavailable");
        }
        if (!submission.manifest)
            assertLegacyAnswerQuestion(answer);
        let videoUrl = null;
        if (answer.uploadStatus === "UPLOADED") {
            try {
                videoUrl = await createVideoViewUrlFromMetadata(answer.storageKey, answer.bucket, answer.mimeType);
            }
            catch {
                // If presigned URL generation fails, return null
                videoUrl = null;
            }
        }
        let audioUrl = null;
        const promptStorageKey = manifestEntry?.promptMediaStorageKey ?? answer.question?.audioStorageKey;
        const promptMimeType = manifestEntry?.promptMediaMimeType ?? answer.question?.audioMimeType;
        if (manifestEntry &&
            (!manifestEntry.promptMediaStorageKey || !manifestEntry.promptMediaMimeType)) {
            throw new Error("Manifest evidence unavailable");
        }
        if (promptStorageKey) {
            try {
                audioUrl = await createQuestionAudioViewUrlFromMetadata(promptStorageKey, promptMimeType);
            }
            catch {
                // A retained manifest must never fall back to current Question media.
                if (manifestEntry)
                    throw new Error("Manifest evidence unavailable");
                // Legacy readers preserve their historical best-effort behavior.
                audioUrl = null;
            }
        }
        if (manifestEntry && !audioUrl) {
            throw new Error("Manifest evidence unavailable");
        }
        const scoreSummary = aggregateStoredScores(answer.scores, submission.scoringSystem);
        const comments = answer.scores.flatMap(({ comment }) => {
            const trimmed = comment?.trim();
            return trimmed ? [trimmed] : [];
        });
        return {
            id: answer.id,
            questionId: manifestEntry?.id ?? answer.questionId,
            questionCategory: manifestEntry?.category ?? answer.question.category,
            audioUrl,
            durationSeconds: answer.durationSeconds,
            videoUrl,
            score: scoreSummary.score,
            rubric: scoreSummary.rubric,
            comments,
        };
    }));
    const scoredAnswers = submission.answers.flatMap((answer) => {
        const score = average(answer.scores.map((item) => Number(item.value)));
        return score == null ? [] : [score];
    });
    const calculatedOverallScore = (submission.status === "SCORED" || submission.status === "CERTIFIED") &&
        answers.length > 0 &&
        scoredAnswers.length === answers.length
        ? average(scoredAnswers)
        : null;
    const answerRubrics = answers.flatMap((answer) => answer.rubric ? [answer.rubric] : []);
    const rubric = submission.scoringSystem === "RUBRIC_6" &&
        answerRubrics.length === answers.length
        ? averageRubrics(answerRubrics)
        : null;
    return {
        id: submission.id,
        status: submission.status,
        score: submission.certificate?.finalScore?.toString() ??
            (calculatedOverallScore == null ? null : roundScore(calculatedOverallScore).toFixed(2)),
        scoringSystem: submission.scoringSystem,
        rubric,
        createdAt: submission.createdAt,
        answers,
    };
}
/** Fetch status only, restricted to the owning student. */
export async function getSubmissionStatus(submissionId, userId) {
    const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { id: true, studentId: true, status: true, updatedAt: true },
    });
    if (!submission || submission.studentId !== userId) {
        throw new Error("Submission not found");
    }
    return {
        id: submission.id,
        status: submission.status,
        updatedAt: submission.updatedAt,
    };
}
/**
 * Mark a submission as complete when all answers have been uploaded.
 * Requires payment or starts examiner assignment based on the current app setting.
 * Only the student who owns the submission can complete it.
 */
export async function completeSubmission(submissionId, userId) {
    const { paymentEnabled } = await getAppSettings();
    const paymentRequired = paymentEnabled;
    // Lock the Submission before reading its evidence. Confirmation and every
    // later upload mutation use the same lifecycle predicate, so a concurrent
    // confirmation either commits before this proof is evaluated or observes
    // the completed status and is rejected.
    const transitioned = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Submission" WHERE "id" = ${submissionId} FOR UPDATE`;
        const submission = await tx.submission.findUnique({
            where: { id: submissionId },
            select: {
                studentId: true,
                status: true,
                manifest: {
                    select: {
                        version: true,
                        entries: { select: { id: true } },
                    },
                },
                answers: {
                    select: {
                        manifestEntryId: true,
                        questionId: true,
                        uploadStatus: true,
                        verifiedAt: true,
                        proofVersion: true,
                        observedMimeType: true,
                        mimeType: true,
                        sizeBytes: true,
                    },
                },
            },
        });
        if (!submission)
            throw new Error("Submission not found");
        if (submission.studentId !== userId)
            throw new Error("Unauthorized");
        // A retry after a committed transition is a successful no-op. Abandoned,
        // legacy in-progress, corrupt, and unknown lifecycle states remain closed.
        if (submission.status !== "IN_PROGRESS") {
            if (["AWAITING_PAYMENT", "PAID", "SCORING", "SCORED", "CERTIFIED"].includes(submission.status)) {
                return false;
            }
            throw new Error("Submission is not in progress");
        }
        if (!submission.manifest) {
            throw new Error("Submission does not contain the exact verified answer set");
        }
        if (submission.manifest.version !== 1)
            throw new Error("Unsupported manifest version");
        const entryIds = new Set(submission.manifest.entries.map((entry) => entry.id));
        const answerIds = submission.answers.map((answer) => answer.manifestEntryId);
        const hasVerifiedProof = submission.answers.every((answer) => answer.uploadStatus === "UPLOADED" &&
            answer.verifiedAt !== null &&
            answer.proofVersion === 1 &&
            answer.sizeBytes !== null && answer.sizeBytes > 0 &&
            answer.observedMimeType !== null &&
            answer.observedMimeType === answer.mimeType);
        if (entryIds.size !== 3 ||
            answerIds.length !== entryIds.size ||
            answerIds.some((id) => !id || !entryIds.has(id)) ||
            new Set(answerIds).size !== entryIds.size ||
            !hasVerifiedProof ||
            submission.answers.some((answer) => answer.questionId !== null)) {
            throw new Error("Submission does not contain the exact verified answer set");
        }
        await tx.submission.update({
            where: { id: submissionId },
            data: {
                paymentRequired,
                status: paymentRequired ? "AWAITING_PAYMENT" : "PAID",
            },
        });
        return true;
    });
    if (transitioned && !paymentRequired) {
        try {
            await assignExaminersToSubmission(submissionId);
        }
        catch (error) {
            // Completion must remain successful even when assignment has to be retried by an admin.
            console.error(`Automatic examiner assignment failed for waived submission ${submissionId}:`, error);
        }
    }
}
