import { getExaminerAssignments, getExaminerAssignmentDetail, completeExaminerScoring, saveExaminerScore, startExaminerAssignment, submitExaminerScores, } from "../service/examiner.service.js";
import { ScoreValidationError } from "../utils/scoring.js";
/**
 * GET /api/examiner/assignments
 * List all assignments for the authenticated examiner.
 */
export async function listAssignments(req, res) {
    try {
        const examinerId = req.user.id;
        const assignments = await getExaminerAssignments(examinerId);
        res.status(200).json({
            status: "success",
            data: assignments,
        });
    }
    catch (error) {
        console.error("List assignments error:", error);
        res.status(500).json({ error: "Failed to load assignments" });
    }
}
/**
 * GET /api/examiner/assignments/:id
 * Get assignment detail with answers and presigned video URLs.
 */
export async function getAssignment(req, res) {
    try {
        const assignmentId = req.params.id;
        const examinerId = req.user.id;
        if (!assignmentId) {
            res.status(400).json({ error: "Assignment ID is required" });
            return;
        }
        const assignment = await getExaminerAssignmentDetail(assignmentId, examinerId);
        res.status(200).json({
            status: "success",
            data: assignment,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load assignment";
        const status = message === "Assignment not found"
            ? 404
            : message === "Unauthorized"
                ? 403
                : 500;
        res.status(status).json({ error: message });
    }
}
/**
 * PUT /api/examiner/assignments/:id/start
 * Mark assignment as IN_PROGRESS.
 */
export async function startAssignment(req, res) {
    try {
        const assignmentId = req.params.id;
        const examinerId = req.user.id;
        if (!assignmentId) {
            res.status(400).json({ error: "Assignment ID is required" });
            return;
        }
        await startExaminerAssignment(assignmentId, examinerId);
        res.status(200).json({
            status: "success",
            message: "Assignment started",
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to start assignment";
        const status = message === "Assignment not found"
            ? 404
            : message === "Unauthorized"
                ? 403
                : message === "Assignment is not in ASSIGNED status"
                    ? 400
                    : 500;
        res.status(status).json({ error: message });
    }
}
function scoringErrorStatus(error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Assignment not found")
        return 404;
    if (message === "Unauthorized")
        return 403;
    if (message === "Assignment is already completed")
        return 400;
    if (error instanceof ScoreValidationError)
        return 400;
    return 500;
}
/** PUT /api/examiner/assignments/:id/scores/:answerId */
export async function saveScore(req, res) {
    try {
        const assignmentId = req.params.id;
        const answerId = req.params.answerId;
        if (!assignmentId || !answerId) {
            res.status(400).json({ error: "Assignment ID and answer ID are required" });
            return;
        }
        const body = (req.body ?? {});
        await saveExaminerScore(assignmentId, req.user.id, {
            answerId,
            value: body.value,
            rubric: body.rubric,
            comment: body.comment,
        });
        res.status(200).json({ status: "success", message: "Question score saved" });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save score";
        res.status(scoringErrorStatus(error)).json({ error: message });
    }
}
/** POST /api/examiner/assignments/:id/complete */
export async function completeScoring(req, res) {
    try {
        const assignmentId = req.params.id;
        if (!assignmentId) {
            res.status(400).json({ error: "Assignment ID is required" });
            return;
        }
        await completeExaminerScoring(assignmentId, req.user.id);
        res.status(200).json({ status: "success", message: "Scoring completed" });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to complete scoring";
        res.status(scoringErrorStatus(error)).json({ error: message });
    }
}
/**
 * POST /api/examiner/assignments/:id/scores
 * Submit scores for all answers in an assignment.
 */
export async function submitScores(req, res) {
    try {
        const assignmentId = req.params.id;
        const examinerId = req.user.id;
        const { scores } = (req.body ?? {});
        if (!assignmentId) {
            res.status(400).json({ error: "Assignment ID is required" });
            return;
        }
        if (!scores || !Array.isArray(scores) || scores.length === 0) {
            res.status(400).json({ error: "scores array is required and must not be empty" });
            return;
        }
        await submitExaminerScores(assignmentId, examinerId, scores);
        res.status(200).json({
            status: "success",
            message: "Scores submitted successfully",
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to submit scores";
        res.status(scoringErrorStatus(error)).json({ error: message });
    }
}
