import type { Request, Response } from "express";
import {
  AdminOpsError,
  getAdminQueues,
  reassignExaminerAssignment,
  waiveSubmissionPayment,
} from "../service/adminOps.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS: Record<AdminOpsError["code"], number> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 403,
  INVALID_LIFECYCLE: 409,
  NOT_REASSIGNABLE: 409,
  INVALID_EXAMINER: 400,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
};

async function handle(res: Response, id: unknown, run: (id: string) => Promise<unknown>) {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "A valid ID is required", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    res.status(200).json({ status: "success", data: await run(id) });
  } catch (error) {
    if (error instanceof AdminOpsError) {
      res.status(STATUS[error.code]).json({ error: error.message, code: error.code });
      return;
    }
    console.error("Admin operation error:", error);
    res.status(500).json({ error: "Admin operation failed" });
  }
}

/** POST /api/admin/submissions/:id/payment-waiver — waive payment for one Submission. */
export function waivePayment(req: Request, res: Response) {
  return handle(res, req.params.id, (id) => waiveSubmissionPayment(id, req.user!.id, req.body?.reason));
}

/** POST /api/admin/assignments/:id/reassign — move untouched ASSIGNED work to another Examiner. */
export function reassignAssignment(req: Request, res: Response) {
  return handle(res, req.params.id, (id) => reassignExaminerAssignment(id, req.user!.id, req.body ?? {}));
}

/** GET /api/admin/queues — open flags, payment reconciliation, and assignment-ready Submissions. */
export async function listQueues(_req: Request, res: Response) {
  try {
    res.status(200).json({ status: "success", data: await getAdminQueues() });
  } catch (error) {
    console.error("List admin queues error:", error);
    res.status(500).json({ error: "Failed to load queues" });
  }
}
