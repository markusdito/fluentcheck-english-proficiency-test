import type { Request, Response } from "express";
import { createSubmission, completeSubmission, getStudentDashboard, getSubmissionDetail } from "../service/submission.service.js";

/**
 * POST /api/submissions
 * Create a new test submission for the authenticated student.
 */
export async function startSubmission(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const submission = await createSubmission(userId);
    res.status(201).json({
      status: "success",
      data: submission,
    });
  } catch (error) {
    console.error("Create submission error:", error);
    res.status(500).json({ error: "Failed to create submission" });
  }
}

/**
 * POST /api/submissions/:id/complete
 * Mark a submission as complete after all answers have been uploaded.
 * Routes it to payment or examiner assignment using the current app setting.
 */
export async function finishSubmission(req: Request, res: Response) {
  try {
    const submissionId = req.params.id as string;
    const userId = req.user!.id;

    if (!submissionId) {
      res.status(400).json({ error: "Submission ID is required" });
      return;
    }

    await completeSubmission(submissionId, userId);
    res.status(200).json({
      status: "success",
      message: "Submission completed successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete submission";
    const status =
      message === "Submission not found" || message === "Unauthorized"
        ? 404
        : message === "Submission is not in progress" ||
          message === "No answers recorded" ||
          message.startsWith("Not all answers uploaded")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

/**
 * GET /api/submissions
 * Fetch dashboard stats and submission history for the authenticated student.
 */
export async function getDashboard(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const data = await getStudentDashboard(userId);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Get dashboard error:", error);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
}

/**
 * GET /api/submissions/:id
 * Fetch a single submission with answers and presigned video URLs.
 */
export async function getSubmissionById(req: Request, res: Response) {
  try {
    const submissionId = req.params.id as string;
    const userId = req.user!.id;

    if (!submissionId) {
      res.status(400).json({ error: "Submission ID is required" });
      return;
    }

    const data = await getSubmissionDetail(submissionId, userId);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load submission";
    const status = message === "Submission not found" || message === "Unauthorized"
      ? 404
      : message === "Answer not found" || message === "Video not yet uploaded"
        ? 404
        : 500;
    res.status(status).json({ error: message });
  }
}
