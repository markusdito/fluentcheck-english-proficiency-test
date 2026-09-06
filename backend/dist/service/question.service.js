import { prisma } from "../config/db.js";
import { Prisma } from "../generated/client.js";
import { QuestionCategory } from "../generated/enums.js";
import { lockPromptMediaStorageIdentity } from "./promptMediaLock.service.js";
export class PositionConflictError extends Error {
    resource;
    coordinate;
    constructor(resource, coordinate) {
        super(`${resource} position ${coordinate} is already occupied by an active ${resource}`);
        this.resource = resource;
        this.coordinate = coordinate;
        this.name = "PositionConflictError";
    }
}
export class DuplicateTaskPositionError extends Error {
    order;
    constructor(order) {
        super(`Task order ${order} is duplicated in the requested Question`);
        this.order = order;
        this.name = "DuplicateTaskPositionError";
    }
}
export class QuestionPromptMediaUnavailableError extends Error {
    storageKey;
    cleanupStatus;
    constructor(storageKey, cleanupStatus) {
        super(cleanupStatus === "DELETED" || cleanupStatus === "MISSING"
            ? `Question cannot be restored after the irreversible Prompt-media cleanup boundary: ${storageKey}`
            : `Question cannot be restored while Prompt-media cleanup is unresolved (${cleanupStatus}): ${storageKey}`);
        this.storageKey = storageKey;
        this.cleanupStatus = cleanupStatus;
        this.name = "QuestionPromptMediaUnavailableError";
    }
}
function isUniqueViolation(error) {
    return ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
        (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002"));
}
function isTaskPositionViolation(error) {
    const target = error.meta?.target;
    if (Array.isArray(target) && target.some((field) => field === "questionId")) {
        return true;
    }
    return /Task_(?:active_)?questionId_order|questionId.*order/u.test(error.message ?? "");
}
function duplicateTaskOrder(tasks) {
    const seen = new Set();
    for (const task of tasks ?? []) {
        if (seen.has(task.order))
            return task.order;
        seen.add(task.order);
    }
    return undefined;
}
function questionPositionConflict(category, order) {
    return new PositionConflictError("Question", `${category}/${order}`);
}
function taskPositionConflict(questionId, order) {
    return new PositionConflictError("Task", `${questionId}/${order}`);
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
/**
 * Retrieve one random question per category (PART_1, PART_2, PART_3)
 * with their tasks, sorted by order.
 */
export async function retrieveQuestions(order) {
    const categories = [
        QuestionCategory.PART_1,
        QuestionCategory.PART_2,
        QuestionCategory.PART_3,
    ];
    // Fetch all non-deleted questions across the three categories
    return prisma.question.findMany({
        where: { deletedAt: null, category: { in: categories }, order: order },
        select: {
            id: true,
            category: true,
            order: true,
            preparationSeconds: true,
            recordingSeconds: true,
            audioStorageKey: true,
            audioMimeType: true,
            audioUploadStatus: true,
            tasks: {
                where: { deletedAt: null },
                orderBy: { order: "asc" },
                select: {
                    id: true,
                    promptText: true,
                    order: true,
                },
            },
        },
    });
}
/**
 * Retrieve every active question for the admin question bank.
 * Draft questions are intentionally included so admins can finish their audio.
 */
export async function retrieveAdminQuestions(includeRetired = false) {
    const categories = [
        QuestionCategory.PART_1,
        QuestionCategory.PART_2,
        QuestionCategory.PART_3,
    ];
    return prisma.question.findMany({
        where: includeRetired
            ? { category: { in: categories } }
            : { deletedAt: null, category: { in: categories } },
        orderBy: [{ category: "asc" }, { order: "asc" }],
        select: {
            id: true,
            category: true,
            order: true,
            preparationSeconds: true,
            recordingSeconds: true,
            audioStorageKey: true,
            audioMimeType: true,
            audioSizeBytes: true,
            audioUploadStatus: true,
            createdAt: true,
            deletedAt: true,
            tasks: {
                ...(includeRetired ? {} : { where: { deletedAt: null } }),
                orderBy: { order: "asc" },
                select: {
                    id: true,
                    promptText: true,
                    order: true,
                    deletedAt: true,
                },
            },
        },
    });
}
/**
 * Retrieve only questions that are ready to be delivered to test takers.
 */
export async function retrieveTestQuestions() {
    const categories = [
        QuestionCategory.PART_1,
        QuestionCategory.PART_2,
        QuestionCategory.PART_3,
    ];
    return prisma.question.findMany({
        where: {
            deletedAt: null,
            category: { in: categories },
            audioUploadStatus: "UPLOADED",
            tasks: { some: { deletedAt: null } },
        },
        select: {
            id: true,
            category: true,
            order: true,
            preparationSeconds: true,
            recordingSeconds: true,
            audioStorageKey: true,
            audioMimeType: true,
            audioUploadStatus: true,
            tasks: {
                where: { deletedAt: null },
                orderBy: { order: "asc" },
                select: {
                    id: true,
                    promptText: true,
                    order: true,
                },
            },
        },
    });
}
/**
 * Create a question and its nested tasks (admin only).
 */
export async function createQuestion(userId, data) {
    const duplicateOrder = duplicateTaskOrder(data.tasks);
    if (duplicateOrder !== undefined) {
        throw new DuplicateTaskPositionError(duplicateOrder);
    }
    try {
        return await prisma.question.create({
            data: {
                category: data.category,
                order: data.order,
                preparationSeconds: data.preparationSeconds ?? 30,
                recordingSeconds: data.recordingSeconds ?? 120,
                createdById: userId,
                tasks: data.tasks?.length
                    ? { create: data.tasks.map((task) => ({ promptText: task.promptText, order: task.order })) }
                    : undefined,
            },
            include: {
                tasks: {
                    where: { deletedAt: null },
                    orderBy: { order: "asc" },
                },
            },
        });
    }
    catch (error) {
        if (!isUniqueViolation(error))
            throw error;
        if (isTaskPositionViolation(error)) {
            throw new DuplicateTaskPositionError(duplicateTaskOrder(data.tasks) ?? 0);
        }
        throw questionPositionConflict(data.category, data.order);
    }
}
/**
 * Update a question's scalar fields (admin only). Tasks are not touched here.
 */
export async function updateQuestion(id, data) {
    const existing = await prisma.question.findUnique({
        where: { id },
        select: { id: true, category: true, order: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt)
        throw new Error("Question not found");
    try {
        return await prisma.question.update({
            where: { id },
            data: {
                ...(data.category !== undefined && { category: data.category }),
                ...(data.order !== undefined && { order: data.order }),
                ...(data.preparationSeconds !== undefined && { preparationSeconds: data.preparationSeconds }),
                ...(data.recordingSeconds !== undefined && { recordingSeconds: data.recordingSeconds }),
            },
            include: {
                tasks: {
                    where: { deletedAt: null },
                    orderBy: { order: "asc" },
                },
            },
        });
    }
    catch (error) {
        if (!isUniqueViolation(error))
            throw error;
        throw questionPositionConflict(data.category ?? existing.category, data.order ?? existing.order);
    }
}
/**
 * Retire a Question from future delivery without mutating retained evidence.
 */
export async function retireQuestion(id) {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.question.findUnique({
            where: { id },
            select: { id: true, deletedAt: true, audioStorageKey: true },
        });
        if (!existing)
            throw new Error("Question not found");
        if (!existing.deletedAt) {
            await lockPromptMediaStorageIdentity(tx, existing.audioStorageKey ?? "");
            await tx.question.updateMany({
                where: { id, deletedAt: null },
                data: { deletedAt: new Date() },
            });
        }
        return tx.question.findUniqueOrThrow({ where: { id } });
    });
}
/**
 * Create a task under an active (non-deleted) question.
 */
export async function createTask(questionId, data) {
    const question = await prisma.question.findUnique({
        where: { id: questionId },
        select: { id: true, deletedAt: true },
    });
    if (!question || question.deletedAt)
        throw new Error("Question not found");
    try {
        return await prisma.task.create({
            data: {
                questionId,
                promptText: data.promptText,
                order: data.order,
            },
        });
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            throw taskPositionConflict(questionId, data.order);
        }
        throw error;
    }
}
/**
 * Update a task belonging to the given question.
 */
export async function updateTask(questionId, taskId, data) {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, questionId: true, order: true, deletedAt: true },
    });
    if (!task || task.deletedAt)
        throw new Error("Task not found");
    if (task.questionId !== questionId)
        throw new Error("Task not found");
    try {
        return await prisma.task.update({
            where: { id: taskId },
            data: {
                ...(data.promptText !== undefined && { promptText: data.promptText }),
                ...(data.order !== undefined && { order: data.order }),
            },
        });
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            throw taskPositionConflict(task.questionId, data.order ?? task.order);
        }
        throw error;
    }
}
/**
 * Soft delete a task belonging to the given question.
 */
export async function deleteTask(questionId, taskId) {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, questionId: true, deletedAt: true },
    });
    if (!task || task.deletedAt)
        throw new Error("Task not found");
    if (task.questionId !== questionId)
        throw new Error("Task not found");
    return prisma.task.update({
        where: { id: taskId },
        data: { deletedAt: new Date() },
    });
}
/** Restore a Question at its original position without changing child Tasks. */
export async function restoreQuestion(id) {
    if (!isUuid(id))
        throw new Error("Question not found");
    return prisma.$transaction(async (transaction) => {
        const existing = await transaction.question.findUnique({
            where: { id },
            select: {
                id: true,
                category: true,
                order: true,
                audioStorageKey: true,
                deletedAt: true,
            },
        });
        if (!existing)
            throw new Error("Question not found");
        if (existing.deletedAt) {
            await lockPromptMediaStorageIdentity(transaction, existing.audioStorageKey ?? "");
            if (existing.audioStorageKey) {
                const cleanupObject = await transaction.promptMediaCleanupObject.findUnique({
                    where: { storageKey: existing.audioStorageKey },
                    select: { status: true },
                });
                if (cleanupObject &&
                    ["FAILED", "DELETE_PENDING", "DELETED", "MISSING"].includes(cleanupObject.status)) {
                    throw new QuestionPromptMediaUnavailableError(existing.audioStorageKey, cleanupObject.status);
                }
            }
            try {
                await transaction.question.update({
                    where: { id },
                    data: { deletedAt: null },
                });
            }
            catch (error) {
                if (isUniqueViolation(error)) {
                    throw questionPositionConflict(existing.category, existing.order);
                }
                throw error;
            }
        }
        return transaction.question.findUniqueOrThrow({
            where: { id },
            include: {
                tasks: {
                    orderBy: { order: "asc" },
                },
            },
        });
    });
}
/** Restore a Task at its original Question/order position independently. */
export async function restoreTask(questionId, taskId) {
    if (!isUuid(questionId) || !isUuid(taskId)) {
        throw new Error("Task not found");
    }
    const existing = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            questionId: true,
            promptText: true,
            order: true,
            deletedAt: true,
        },
    });
    if (!existing || existing.questionId !== questionId) {
        throw new Error("Task not found");
    }
    if (existing.deletedAt) {
        try {
            await prisma.task.update({
                where: { id: taskId },
                data: { deletedAt: null },
            });
        }
        catch (error) {
            if (isUniqueViolation(error)) {
                throw taskPositionConflict(questionId, existing.order);
            }
            throw error;
        }
    }
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task)
        throw new Error("Task not found");
    return task;
}
