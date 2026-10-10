import type { Request, Response } from "express";
import {
  SubmissionFlagError,
  confirmFlag,
  dismissFlag,
  listOpenFlags,
  raiseDeviceFlag,
  raiseIntegrityConcern,
} from "../service/submissionFlag.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS: Record<SubmissionFlagError["code"], number> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 403,
  INVALID_LIFECYCLE: 409,
  ALREADY_RESOLVED: 409,
  VALIDATION_ERROR: 400,
};

async function handle(res: Response, id: unknown, run: (id: string) => Promise<unknown>, created = false) {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "A valid ID is required", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const data = await run(id);
    res.status(created ? 201 : 200).json({ status: "success", data });
  } catch (error) {
    if (error instanceof SubmissionFlagError) {
      res.status(STATUS[error.code]).json({ error: error.message, code: error.code });
      return;
    }
    console.error("Submission flag error:", error);
    res.status(500).json({ error: "Flag request failed" });
  }
}

/** POST /api/submissions/:id/flags — the test client reports a device failure. */
export function raiseSubmissionDeviceFlag(req: Request, res: Response) {
  return handle(res, req.params.id, (id) => raiseDeviceFlag(id, req.user!.id, req.body ?? {}), true);
}

/** POST /api/examiner/assignments/:id/integrity-concerns */
export function raiseAssignmentIntegrityConcern(req: Request, res: Response) {
  return handle(res, req.params.id, (id) => raiseIntegrityConcern(id, req.user!.id, req.body ?? {}), true);
}

/** GET /api/admin/flags — open flags with evidence. */
export async function listFlags(_req: Request, res: Response) {
  try {
    res.status(200).json({ status: "success", data: await listOpenFlags() });
  } catch (error) {
    console.error("List flags error:", error);
    res.status(500).json({ error: "Failed to load flags" });
  }
}

/** POST /api/admin/flags/:id/confirm — void the Submission and grant a free retake. */
export function confirmSubmissionFlag(req: Request, res: Response) {
  return handle(res, req.params.id, (id) => confirmFlag(id, req.user!.id, req.body?.note));
}

/** POST /api/admin/flags/:id/dismiss — false alarm; the Submission returns to its flow. */
export function dismissSubmissionFlag(req: Request, res: Response) {
  return handle(res, req.params.id, (id) => dismissFlag(id, req.user!.id, req.body?.note));
}
