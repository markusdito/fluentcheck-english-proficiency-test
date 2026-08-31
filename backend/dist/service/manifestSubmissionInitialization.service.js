import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { createQuestionAudioViewUrlFromMetadata } from "./upload.service.js";
import { buildManifestDelivery, ManifestEvidenceUnavailableError, } from "./submissionManifestDelivery.service.js";
const CATEGORIES = ["PART_1", "PART_2", "PART_3"];
const INITIALIZATION_DEADLINE_MS = 10_000;
export class AssessmentUnavailableError extends Error {
    code = "ASSESSMENT_UNAVAILABLE";
    retryable = true;
    retryAfterSeconds = 5;
    constructor(message = "Assessment unavailable") {
        super(message);
        this.name = "AssessmentUnavailableError";
    }
}
export class ActiveSubmissionConflictError extends Error {
    submissionId;
    constructor(submissionId) {
        super("An active Submission already exists");
        this.submissionId = submissionId;
        this.name = "ActiveSubmissionConflictError";
    }
}
/** The same idempotency key cannot be used for another student's start intent. */
export class IdempotencyKeyConflictError extends Error {
    constructor() {
        super("Idempotency-Key is already associated with another student");
        this.name = "IdempotencyKeyConflictError";
    }
}
class EligibilityConflictError extends Error {
    constructor() {
        super("Selected assessment evidence changed during initialization");
        this.name = "EligibilityConflictError";
    }
}
function withDeadline(promise, deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
        return Promise.reject(new AssessmentUnavailableError());
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new AssessmentUnavailableError()), remaining);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
export function reportAssessmentInitializationFailure(event) {
    console.error("Assessment initialization failed", event);
}
function isUniqueViolation(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
async function replayStartIntent(studentId, idempotencyKey, signPromptMedia) {
    const existingIntent = await prisma.submissionStartIntent.findUnique({
        where: { idempotencyKey },
        include: { submission: { include: { manifest: { include: { entries: { include: { tasks: true } } } } } } },
    });
    if (!existingIntent)
        return undefined;
    if (existingIntent.studentId !== studentId)
        throw new IdempotencyKeyConflictError();
    if (!existingIntent.submission.manifest)
        throw new AssessmentUnavailableError();
    const manifest = {
        id: existingIntent.submission.manifest.id,
        version: existingIntent.submission.manifest.version,
        entries: existingIntent.submission.manifest.entries.map((entry) => ({
            id: entry.id,
            category: entry.category,
            deliveryPosition: entry.deliveryPosition,
            preparationSeconds: entry.preparationSeconds,
            recordingSeconds: entry.recordingSeconds,
            promptMediaStorageKey: entry.promptMediaStorageKey,
            promptMediaMimeType: entry.promptMediaMimeType,
            promptMediaSizeBytes: entry.promptMediaSizeBytes,
            tasks: entry.tasks.map((task) => ({ deliveredOrder: task.deliveredOrder, deliveredText: task.deliveredText })),
        })),
    };
    const entries = await buildManifestDelivery(manifest, signPromptMedia);
    return { submissionId: existingIntent.submissionId, status: existingIntent.submission.status, manifestId: manifest.id, version: manifest.version, entries };
}
/** Select, snapshot, and persist one complete manifest atomically. */
export async function initializeManifestSubmission(studentId, idempotencyKey, dependencies = {}) {
    const chooseIndex = dependencies.chooseIndex ?? ((length) => randomInt(length));
    const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
    const deadline = dependencies.deadline ?? (dependencies.now ?? Date.now)() + INITIALIZATION_DEADLINE_MS;
    const observeFailure = dependencies.observeFailure ?? reportAssessmentInitializationFailure;
    try {
        if (idempotencyKey) {
            const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia);
            if (replay)
                return replay;
        }
        const active = await prisma.submission.findFirst({
            where: { studentId, status: "IN_PROGRESS" },
            select: { id: true },
        });
        if (active)
            throw new ActiveSubmissionConflictError(active.id);
        const selected = await Promise.all(CATEGORIES.map(async (category) => {
            const candidates = await prisma.question.findMany({
                where: {
                    category,
                    deletedAt: null,
                    audioUploadStatus: "UPLOADED",
                    audioStorageKey: { not: null },
                    audioMimeType: { not: null },
                    audioSizeBytes: { not: null },
                    tasks: { some: { deletedAt: null } },
                },
                orderBy: { id: "asc" },
                include: {
                    tasks: {
                        where: { deletedAt: null },
                        orderBy: { order: "asc" },
                    },
                },
            });
            if (candidates.length === 0)
                throw new AssessmentUnavailableError();
            return candidates[chooseIndex(candidates.length)];
        }));
        const manifestId = randomUUID();
        const prepared = selected.map((question, index) => {
            if (!question.audioStorageKey ||
                !question.audioMimeType ||
                question.audioSizeBytes === null ||
                question.audioSizeBytes <= 0) {
                throw new AssessmentUnavailableError();
            }
            return {
                question,
                deliveryPosition: index + 1,
                manifestEntryId: randomUUID(),
            };
        });
        const safe = await buildManifestDelivery({
            id: manifestId,
            version: 1,
            entries: prepared.map((item) => ({
                id: item.manifestEntryId,
                category: item.question.category,
                deliveryPosition: item.deliveryPosition,
                preparationSeconds: item.question.preparationSeconds,
                recordingSeconds: item.question.recordingSeconds,
                promptMediaStorageKey: item.question.audioStorageKey,
                promptMediaMimeType: item.question.audioMimeType,
                promptMediaSizeBytes: item.question.audioSizeBytes,
                tasks: item.question.tasks.map((task) => ({
                    deliveredOrder: task.order,
                    deliveredText: task.promptText,
                })),
            })),
        }, (key, mime) => withDeadline(signPromptMedia(key, mime), deadline));
        const result = await prisma.$transaction(async (tx) => {
            const submission = await tx.submission.create({
                data: { studentId, status: "IN_PROGRESS" },
            });
            const manifest = await tx.submissionManifest.create({
                data: { id: manifestId, submissionId: submission.id, version: 1 },
            });
            for (const item of prepared) {
                const current = await tx.question.findUnique({
                    where: { id: item.question.id },
                    include: { tasks: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
                });
                if (!current || current.deletedAt || current.audioStorageKey !== item.question.audioStorageKey ||
                    current.audioMimeType !== item.question.audioMimeType || current.audioSizeBytes !== item.question.audioSizeBytes ||
                    current.preparationSeconds !== item.question.preparationSeconds ||
                    current.recordingSeconds !== item.question.recordingSeconds ||
                    current.tasks.length !== item.question.tasks.length || current.tasks.some((task, index) => task.id !== item.question.tasks[index]?.id || task.promptText !== item.question.tasks[index]?.promptText ||
                    task.order !== item.question.tasks[index]?.order)) {
                    throw new EligibilityConflictError();
                }
                const entry = await tx.manifestEntry.create({
                    data: {
                        id: item.manifestEntryId,
                        manifestId: manifest.id,
                        submissionId: submission.id,
                        category: item.question.category,
                        deliveryPosition: item.deliveryPosition,
                        sourceQuestionId: item.question.id,
                        preparationSeconds: item.question.preparationSeconds,
                        recordingSeconds: item.question.recordingSeconds,
                        promptMediaStorageKey: item.question.audioStorageKey,
                        promptMediaMimeType: item.question.audioMimeType,
                        promptMediaSizeBytes: item.question.audioSizeBytes,
                    },
                });
                for (const task of item.question.tasks) {
                    await tx.manifestTask.create({
                        data: {
                            manifestEntryId: entry.id,
                            sourceQuestionId: item.question.id,
                            sourceTaskId: task.id,
                            deliveredOrder: task.order,
                            deliveredText: task.promptText,
                        },
                    });
                }
            }
            if (idempotencyKey) {
                await tx.submissionStartIntent.create({
                    data: { idempotencyKey, studentId, submissionId: submission.id },
                });
            }
            return { submission, manifest };
        });
        return {
            submissionId: result.submission.id,
            status: result.submission.status,
            manifestId: result.manifest.id,
            version: result.manifest.version,
            entries: safe,
        };
    }
    catch (error) {
        if (error instanceof EligibilityConflictError && (dependencies.attempt ?? 0) < 2) {
            return initializeManifestSubmission(studentId, idempotencyKey, {
                ...dependencies,
                attempt: (dependencies.attempt ?? 0) + 1,
                deadline,
            });
        }
        if (error instanceof Error && error.message.includes("Submission_one_active_per_student_key")) {
            const active = await prisma.submission.findFirst({
                where: { studentId, status: "IN_PROGRESS" },
                select: { id: true },
            });
            if (active)
                throw new ActiveSubmissionConflictError(active.id);
        }
        if (idempotencyKey && isUniqueViolation(error)) {
            // A concurrent request may have won the idempotency insert after the
            // initial lookup. Replay its committed result after the transaction rolls
            // back, preserving exactly one manifest for the key.
            const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia);
            if (replay)
                return replay;
            throw new IdempotencyKeyConflictError();
        }
        if (!(error instanceof ActiveSubmissionConflictError) &&
            !(error instanceof IdempotencyKeyConflictError)) {
            const classification = error instanceof EligibilityConflictError
                ? "ELIGIBILITY_CONFLICT"
                : error instanceof AssessmentUnavailableError || error instanceof ManifestEvidenceUnavailableError
                    ? "PREPARATION"
                    : "UNKNOWN";
            const diagnostics = error instanceof ManifestEvidenceUnavailableError
                ? error.diagnostics
                : undefined;
            try {
                observeFailure({
                    classification,
                    categoryCount: CATEGORIES.length,
                    failureCount: diagnostics?.failureCount ?? 1,
                    ...(diagnostics ? { failedEntries: diagnostics.failures } : {}),
                });
            }
            catch {
                // Observability failures must never alter initialization behavior.
            }
        }
        if (error instanceof AssessmentUnavailableError || error instanceof ManifestEvidenceUnavailableError || error instanceof EligibilityConflictError) {
            throw new AssessmentUnavailableError();
        }
        throw error;
    }
}
export async function resumeManifestSubmission(studentId, dependencies = {}) {
    const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
    const submission = await prisma.submission.findFirst({
        where: { studentId, status: "IN_PROGRESS" },
        orderBy: { createdAt: "desc" },
        include: {
            manifest: { include: { entries: { include: { tasks: true } } } },
            answers: { select: { manifestEntryId: true, uploadStatus: true } },
        },
    });
    if (!submission?.manifest)
        throw new AssessmentUnavailableError("No active assessment");
    const manifest = {
        id: submission.manifest.id,
        version: submission.manifest.version,
        entries: submission.manifest.entries.map((entry) => ({
            id: entry.id,
            category: entry.category,
            deliveryPosition: entry.deliveryPosition,
            preparationSeconds: entry.preparationSeconds,
            recordingSeconds: entry.recordingSeconds,
            promptMediaStorageKey: entry.promptMediaStorageKey,
            promptMediaMimeType: entry.promptMediaMimeType,
            promptMediaSizeBytes: entry.promptMediaSizeBytes,
            tasks: entry.tasks.map((task) => ({ deliveredOrder: task.deliveredOrder, deliveredText: task.deliveredText })),
        })),
    };
    let entries;
    try {
        entries = await buildManifestDelivery(manifest, signPromptMedia);
    }
    catch (error) {
        if (!(error instanceof ManifestEvidenceUnavailableError))
            throw error;
        const observeFailure = dependencies.observeFailure ?? reportAssessmentInitializationFailure;
        try {
            observeFailure({
                classification: "PREPARATION",
                categoryCount: CATEGORIES.length,
                failureCount: error.diagnostics?.failureCount ?? 1,
                ...(error.diagnostics ? { failedEntries: error.diagnostics.failures } : {}),
            });
        }
        catch {
            // Observability failures must never alter initialization behavior.
        }
        throw new AssessmentUnavailableError();
    }
    return {
        submissionId: submission.id,
        status: submission.status,
        manifestId: manifest.id,
        version: manifest.version,
        entries,
        uploadedEntryIds: submission.answers
            .filter((answer) => answer.uploadStatus === "UPLOADED" && answer.manifestEntryId)
            .map((answer) => answer.manifestEntryId),
    };
}
