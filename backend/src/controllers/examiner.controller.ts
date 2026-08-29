import type { Request, Response } from "express";
import {
  getExaminerAssignments,
  getExaminerAssignmentDetail,
  completeExaminerScoring,
  saveExaminerScore,
  startExaminerAssignment,
  submitExaminerScores,
  ScoringFinalizationError,
  type ScoreInput,
} from "../service/examiner.service.js";
import { ScoreValidationError } from "../utils/scoring.js";

/**
 * GET /api/examiner/assignments
 * List all assignments for the authenticated examiner.
 */
export async function listAssignments(req: Request, res: Response) {
  try {
    const examinerId = req.user!.id;
    const assignments = await getExaminerAssignments(examinerId);
    res.status(200).json({
      status: "success",
      data: assignments,
    });
  } catch (error) {
    console.error("List assignments error:", error);
    res.status(500).json({ error: "Failed to load assignments" });
  }
}

/**
 * GET /api/examiner/assignments/:id
 * Get assignment detail with answers and presigned video URLs.
 */
export async function getAssignment(req: Request, res: Response) {
  try {
    const assignmentId = req.params.id as string;
    const examinerId = req.user!.id;

    if (!assignmentId) {
      res.status(400).json({ error: "Assignment ID is required" });
      return;
    }

    const assignment = await getExaminerAssignmentDetail(assignmentId, examinerId);
    res.status(200).json({
      status: "success",
      data: assignment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load assignment";
    const status =
      message === "Assignment not found"
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
export async function startAssignment(req: Request, res: Response) {
  try {
    const assignmentId = req.params.id as string;
    const examinerId = req.user!.id;

    if (!assignmentId) {
      res.status(400).json({ error: "Assignment ID is required" });
      return;
    }

    await startExaminerAssignment(assignmentId, examinerId);
    res.status(200).json({
      status: "success",
      message: "Assignment started",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start assignment";
    const status =
      message === "Assignment not found"
        ? 404
        : message === "Unauthorized"
          ? 403
          : message === "Assignment is not in ASSIGNED status"
            ? 400
            : 500;
    res.status(status).json({ error: message });
  }
}

interface ScoreBody {
  scores: ScoreInput[];
}

type SingleScoreBody = Omit<ScoreInput, "answerId">;

function scoringErrorStatus(error: unknown): number {
  if (error instanceof ScoringFinalizationError) {
    if (error.code === "ASSIGNMENT_NOT_FOUND") return 404;
    if (error.code === "UNAUTHORIZED") return 403;
    return 409;
  }
  const message = error instanceof Error ? error.message : "";
  if (error instanceof ScoreValidationError) return 400;
  return 500;
}

function scoringErrorCode(error: unknown): string | undefined {
  if (error instanceof ScoringFinalizationError) return error.code;
  if (error instanceof ScoreValidationError) return "VALIDATION_ERROR";
  return undefined;
}

function sendScoringError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const code = scoringErrorCode(error);
  res.status(scoringErrorStatus(error)).json({
    error: message,
    ...(code ? { code } : {}),
  });
}

/** PUT /api/examiner/assignments/:id/scores/:answerId */
export async function saveScore(req: Request, res: Response) {
  try {
    const assignmentId = req.params.id as string;
    const answerId = req.params.answerId as string;
    if (!assignmentId || !answerId) {
      res.status(400).json({
        error: "Assignment ID and answer ID are required",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const body = (req.body ?? {}) as SingleScoreBody;
    await saveExaminerScore(assignmentId, req.user!.id, {
      answerId,
      value: body.value,
      rubric: body.rubric,
      comment: body.comment,
    });
    res.status(200).json({ status: "success", message: "Question score saved" });
  } catch (error) {
    sendScoringError(res, error, "Failed to save score");
  }
}

/** POST /api/examiner/assignments/:id/complete */
export async function completeScoring(req: Request, res: Response) {
  try {
    const assignmentId = req.params.id as string;
    if (!assignmentId) {
      res.status(400).json({
        error: "Assignment ID is required",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const result = await completeExaminerScoring(assignmentId, req.user!.id);
    res.status(200).json({ status: "success", data: result });
  } catch (error) {
    sendScoringError(res, error, "Failed to complete scoring");
  }
}

/**
 * POST /api/examiner/assignments/:id/scores
 * Submit scores for all answers in an assignment.
 */
export async function submitScores(req: Request, res: Response) {
  try {
    const assignmentId = req.params.id as string;
    const examinerId = req.user!.id;
    const { scores } = (req.body ?? {}) as Partial<ScoreBody>;

    if (!assignmentId) {
      res.status(400).json({ error: "Assignment ID is required" });
      return;
    }

    if (!scores || !Array.isArray(scores) || scores.length === 0) {
      res.status(400).json({
        error: "scores array is required and must not be empty",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const result = await submitExaminerScores(assignmentId, examinerId, scores);
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    sendScoringError(res, error, "Failed to submit scores");
  }
}
