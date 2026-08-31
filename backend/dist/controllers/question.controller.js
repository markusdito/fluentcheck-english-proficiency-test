import { Prisma } from "../generated/client.js";
import { QuestionCategory } from "../generated/enums.js";
import { retrieveQuestions, retrieveAdminQuestions, retrieveTestQuestions, createQuestion as createQuestionService, updateQuestion as updateQuestionService, retireQuestion as retireQuestionService, restoreQuestion as restoreQuestionService, createTask as createTaskService, updateTask as updateTaskService, deleteTask as deleteTaskService, restoreTask as restoreTaskService, PositionConflictError, } from "../service/question.service.js";
import { createQuestionAudioPresignedUpload, confirmQuestionAudioUpload, createQuestionAudioViewUrl, createQuestionAudioViewUrlFromMetadata, } from "../service/upload.service.js";
import { buildTestQuestionDelivery } from "../service/test-question-delivery.service.js";
function handleQuestionAudioError(res, error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Question not found"
        ? 404
        : message === "Prompt media already uploaded" ||
            message === "No pending Prompt media upload for this Question" ||
            message === "Concurrent confirmation — Prompt media already finalized" ||
            message === "Prompt media not yet uploaded"
            ? 409
            : message === "Invalid questionId" || message === "Invalid mimeType" || message === "Invalid audio storage key"
                ? 400
                : 500;
    res.status(status).json({ error: message });
}
/**
 * POST /api/questions/audio/presigned-url
 * Generate a presigned PUT URL for a question's prompt audio (admin only).
 */
export async function createQuestionAudioPresignedUrl(req, res) {
    try {
        const { questionId, mimeType } = req.body;
        if (!questionId || !mimeType) {
            res.status(400).json({ error: "questionId and mimeType are required" });
            return;
        }
        const result = await createQuestionAudioPresignedUpload(questionId, mimeType);
        res.status(201).json({ status: "success", data: result });
    }
    catch (error) {
        handleQuestionAudioError(res, error);
    }
}
/**
 * POST /api/questions/audio/confirm
 * Confirm a question's prompt audio was uploaded to R2 (admin only).
 */
export async function confirmQuestionAudioUploadHandler(req, res) {
    try {
        const { questionId } = req.body;
        if (!questionId) {
            res.status(400).json({ error: "questionId is required" });
            return;
        }
        await confirmQuestionAudioUpload(questionId);
        res.status(200).json({ status: "success", message: "Audio confirmed" });
    }
    catch (error) {
        handleQuestionAudioError(res, error);
    }
}
/**
 * GET /api/questions/:id/audio-url
 * Presigned GET URL for a question's prompt audio (any authed user).
 */
export async function getQuestionAudioUrl(req, res) {
    try {
        const url = await createQuestionAudioViewUrl(req.params.id);
        res.status(200).json({ status: "success", data: { url } });
    }
    catch (error) {
        handleQuestionAudioError(res, error);
    }
}
/**
 * GET /api/questions/test
 * Return test questions and their signed prompt audio URLs in one response.
 */
export async function getTestQuestions(req, res) {
    try {
        const questions = await retrieveTestQuestions(2);
        const data = await buildTestQuestionDelivery(questions, createQuestionAudioViewUrlFromMetadata);
        res.status(200).json({ status: "success", data });
    }
    catch (error) {
        console.error("Error fetching test questions:", error);
        res.status(500).json({ error: "Failed to fetch test questions" });
    }
}
function isQuestionCategory(value) {
    return (typeof value === "string" &&
        Object.values(QuestionCategory).includes(value));
}
function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function handleQuestionError(res, error) {
    if (error instanceof PositionConflictError) {
        res.status(409).json({ error: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        res.status(409).json({ error: "The requested question or task position is already occupied" });
        return;
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message === "Question not found" || message === "Task not found" ? 404 : 500;
    res.status(status).json({ error: message });
}
export async function getQuestions(req, res) {
    try {
        const questions = await retrieveQuestions(2);
        res.status(200).json({
            status: "success",
            data: questions,
        });
    }
    catch (error) {
        console.error("Error fetching questions:", error);
        res.status(500).json({ error: "Failed to fetch questions" });
    }
}
export async function getAdminQuestions(req, res) {
    try {
        const includeRetired = req.query.includeRetired === "true";
        const questions = await retrieveAdminQuestions(includeRetired);
        res.status(200).json({
            status: "success",
            data: questions,
        });
    }
    catch (error) {
        console.error("Error fetching admin questions:", error);
        res.status(500).json({ error: "Failed to fetch admin questions" });
    }
}
export async function restoreQuestion(req, res) {
    try {
        const question = await restoreQuestionService(req.params.id);
        res.status(200).json({ status: "success", data: question });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function createQuestion(req, res) {
    try {
        const { category, order, preparationSeconds, recordingSeconds, tasks } = req.body;
        if (!isQuestionCategory(category)) {
            res.status(400).json({ error: "Category must be one of PART_1, PART_2 or PART_3" });
            return;
        }
        if (!isNonNegativeInteger(order)) {
            res.status(400).json({ error: "order is required and must be a non-negative integer" });
            return;
        }
        if (preparationSeconds !== undefined && !isNonNegativeInteger(preparationSeconds)) {
            res.status(400).json({ error: "preparationSeconds must be a non-negative integer" });
            return;
        }
        if (recordingSeconds !== undefined && !isNonNegativeInteger(recordingSeconds)) {
            res.status(400).json({ error: "recordingSeconds must be a non-negative integer" });
            return;
        }
        if (tasks !== undefined) {
            if (!Array.isArray(tasks)) {
                res.status(400).json({ error: "tasks must be an array" });
                return;
            }
            for (const task of tasks) {
                if (typeof task?.promptText !== "string" ||
                    task.promptText.trim() === "" ||
                    !isNonNegativeInteger(task.order)) {
                    res.status(400).json({ error: "Each task requires promptText and order" });
                    return;
                }
            }
        }
        const question = await createQuestionService(req.user.id, {
            category,
            order,
            preparationSeconds,
            recordingSeconds,
            tasks: tasks?.map((task) => ({
                promptText: task.promptText.trim(),
                order: task.order,
            })),
        });
        res.status(201).json({ status: "success", data: question });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function updateQuestion(req, res) {
    try {
        const id = req.params.id;
        const { category, order, preparationSeconds, recordingSeconds } = req.body;
        if (category !== undefined && !isQuestionCategory(category)) {
            res.status(400).json({ error: "Category must be one of PART_1, PART_2 or PART_3" });
            return;
        }
        if (order !== undefined && !isNonNegativeInteger(order)) {
            res.status(400).json({ error: "order must be a non-negative integer" });
            return;
        }
        if (preparationSeconds !== undefined && !isNonNegativeInteger(preparationSeconds)) {
            res.status(400).json({ error: "preparationSeconds must be a non-negative integer" });
            return;
        }
        if (recordingSeconds !== undefined && !isNonNegativeInteger(recordingSeconds)) {
            res.status(400).json({ error: "recordingSeconds must be a non-negative integer" });
            return;
        }
        const question = await updateQuestionService(id, {
            category,
            order,
            preparationSeconds,
            recordingSeconds,
        });
        res.status(200).json({ status: "success", data: question });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function retireQuestion(req, res) {
    try {
        const id = req.params.id;
        await retireQuestionService(id);
        res.status(200).json({ status: "success" });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function createTask(req, res) {
    try {
        const questionId = req.params.id;
        const { promptText, order } = req.body;
        if (typeof promptText !== "string" || promptText.trim() === "") {
            res.status(400).json({ error: "promptText is required" });
            return;
        }
        if (!isNonNegativeInteger(order)) {
            res.status(400).json({ error: "order is required and must be a non-negative integer" });
            return;
        }
        const task = await createTaskService(questionId, { promptText: promptText.trim(), order });
        res.status(201).json({ status: "success", data: task });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function updateTask(req, res) {
    try {
        const questionId = req.params.id;
        const taskId = req.params.taskId;
        const { promptText, order } = req.body;
        if (promptText !== undefined && (typeof promptText !== "string" || promptText.trim() === "")) {
            res.status(400).json({ error: "promptText must be a non-empty string" });
            return;
        }
        if (order !== undefined && !isNonNegativeInteger(order)) {
            res.status(400).json({ error: "order must be a non-negative integer" });
            return;
        }
        const task = await updateTaskService(questionId, taskId, {
            promptText: promptText?.trim(),
            order,
        });
        res.status(200).json({ status: "success", data: task });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function deleteTask(req, res) {
    try {
        const questionId = req.params.id;
        const taskId = req.params.taskId;
        await deleteTaskService(questionId, taskId);
        res.status(200).json({ status: "success" });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
export async function restoreTask(req, res) {
    try {
        const questionId = req.params.id;
        const taskId = req.params.taskId;
        const task = await restoreTaskService(questionId, taskId);
        res.status(200).json({ status: "success", data: task });
    }
    catch (error) {
        handleQuestionError(res, error);
    }
}
