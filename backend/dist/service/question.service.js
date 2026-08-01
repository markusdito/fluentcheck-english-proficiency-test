import { prisma } from "../config/db.js";
import { QuestionCategory } from "../generated/enums.js";
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
        include: {
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
    return prisma.question.create({
        data: {
            category: data.category,
            promptText: data.promptText,
            order: data.order,
            preparationSeconds: data.preparationSeconds ?? 30,
            recordingSeconds: data.recordingSeconds ?? 120,
            createdById: userId,
            tasks: data.tasks?.length
                ? { create: data.tasks.map((task) => ({ promptText: task.promptText, order: task.order })) }
                : undefined,
        },
        include: { tasks: true },
    });
}
/**
 * Update a question's scalar fields (admin only). Tasks are not touched here.
 */
export async function updateQuestion(id, data) {
    const existing = await prisma.question.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt)
        throw new Error("Question not found");
    return prisma.question.update({
        where: { id },
        data: {
            ...(data.category !== undefined && { category: data.category }),
            ...(data.promptText !== undefined && { promptText: data.promptText }),
            ...(data.order !== undefined && { order: data.order }),
            ...(data.preparationSeconds !== undefined && { preparationSeconds: data.preparationSeconds }),
            ...(data.recordingSeconds !== undefined && { recordingSeconds: data.recordingSeconds }),
        },
        include: { tasks: true },
    });
}
/**
 * Soft delete a question (admin only). Historical answers are preserved.
 */
export async function deleteQuestion(id) {
    const existing = await prisma.question.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt)
        throw new Error("Question not found");
    return prisma.question.update({
        where: { id },
        data: { deletedAt: new Date() },
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
    return prisma.task.create({
        data: {
            questionId,
            promptText: data.promptText,
            order: data.order,
        },
    });
}
/**
 * Update a task belonging to the given question.
 */
export async function updateTask(questionId, taskId, data) {
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
        data: {
            ...(data.promptText !== undefined && { promptText: data.promptText }),
            ...(data.order !== undefined && { order: data.order }),
        },
    });
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
