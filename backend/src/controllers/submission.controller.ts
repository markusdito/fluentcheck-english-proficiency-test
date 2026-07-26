import type { Request, Response } from "express";
import { createSubmission } from "../service/submission.service.js";

/**
 * POST /api/submissions
 * Create a new test submission for the authenticated user.
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