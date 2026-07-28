import { getExaminerAssignments, getExaminerAssignmentDetail, startExaminerAssignment, submitExaminerScores, } from "../service/examiner.service.js";
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
/**
 * POST /api/examiner/assignments/:id/scores
 * Submit scores for all answers in an assignment.
 */
export async function submitScores(req, res) {
    try {
        const assignmentId = req.params.id;
        const examinerId = req.user.id;
        const { scores } = req.body;
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
        const status = message === "Assignment not found"
            ? 404
            : message === "Unauthorized"
                ? 403
                : message === "Assignment is already completed"
                    ? 400
                    : message.startsWith("Score value")
                        ? 400
                        : 500;
        res.status(status).json({ error: message });
    }
}
