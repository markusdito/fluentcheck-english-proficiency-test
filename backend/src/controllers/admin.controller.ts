import type { Request, Response } from "express";
import {
  listAdminUsers,
  changeUserRole,
  listAdminExaminers,
  assignExaminers,
  getAdminStats,
  getAdminSubmissionDetail,
  listAdminSubmissions,
  previewUserRoleTransition,
} from "../service/admin.service.js";
import {
  getAppSettings,
  updatePaymentEnabled,
} from "../service/settings.service.js";
import { AssignmentSetError } from "../service/examiner.service.js";
import { AccountTransitionError } from "../service/accountTransition.service.js";
import { Role, SubmissionStatus } from "../generated/enums.js";
import { Prisma } from "../generated/client.js";
import {
  approveSubmissionPurge,
  cancelSubmissionPurge,
  createRetentionHold,
  finalizeSubmissionPurge,
  getSubmissionPurgeRequest,
  requestSubmissionPurge,
  releaseRetentionHold,
  RetentionOperationError,
} from "../service/submissionRetention.service.js";

const ADMIN_ROLES: readonly string[] = ["STUDENT", "EXAMINER", "ADMIN"];
const ADMIN_SUBMISSION_STATUSES: readonly string[] = Object.values(SubmissionStatus).filter(
  (status) => status !== "IN_PROGRESS",
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function accountTransitionStatus(error: AccountTransitionError): number {
  switch (error.code) {
    case "USER_NOT_FOUND":
      return 404;
    case "UNAUTHORIZED":
      return 403;
    case "INVALID_ROLE":
    case "INVALID_REASSIGNMENT":
    case "SELF_ROLE_CHANGE":
      return 400;
    default:
      return 409;
  }
}

function validateReassignmentMapInput(value: unknown): void {
  if (value === undefined) return;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AccountTransitionError(
      "INVALID_REASSIGNMENT",
      "Reassignment map must be an object",
    );
  }

  const replacementIds = new Set<string>();
  for (const [assignmentId, examinerId] of Object.entries(value)) {
    if (
      !UUID_RE.test(assignmentId) ||
      typeof examinerId !== "string" ||
      !UUID_RE.test(examinerId)
    ) {
      throw new AccountTransitionError(
        "INVALID_REASSIGNMENT",
        "Reassignment map must contain valid assignment and examiner IDs",
      );
    }
    if (replacementIds.has(examinerId)) {
      throw new AccountTransitionError(
        "INVALID_REASSIGNMENT",
        "Each replacement examiner must be assigned at most once",
      );
    }
    replacementIds.add(examinerId);
  }
}

/**
 * GET /api/admin/users
 * List users with pagination and optional role/q filtering.
 */
export async function listUsers(req: Request, res: Response) {
  try {
    const pageRaw = Number(req.query.page ?? 1);
    if (!Number.isInteger(pageRaw) || pageRaw < 1) {
      res.status(400).json({ error: "page must be a positive integer" });
      return;
    }
    const page = pageRaw;

    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(100, Math.max(1, Math.trunc(limitRaw)))
      : 20;

    let role: Role | undefined;
    if (req.query.role !== undefined) {
      const rawRole = String(req.query.role);
      if (!ADMIN_ROLES.includes(rawRole)) {
        res
          .status(400)
          .json({ error: "role must be one of STUDENT, EXAMINER, ADMIN" });
        return;
      }
      role = rawRole as Role;
    }

    const q =
      typeof req.query.q === "string" && req.query.q.trim().length > 0
        ? req.query.q
        : undefined;

    const data = await listAdminUsers({ page, limit, role, q });

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to load users" });
  }
}

/**
 * PUT /api/admin/users/:id/role
 * Change a user's role.
 */
export async function updateUserRole(req: Request, res: Response) {
  try {
    const userId = req.params.id as string;
    if (!userId) {
      res.status(400).json({ error: "User ID is required" });
      return;
    }

    const { role, reassignmentMap } = req.body as {
      role?: unknown;
      reassignmentMap?: unknown;
    };
    if (typeof role !== "string" || !ADMIN_ROLES.includes(role)) {
      res
        .status(400)
        .json({
          error: "Role must be one of STUDENT, EXAMINER, ADMIN",
          code: "INVALID_ROLE",
        });
      return;
    }

    if (userId === req.user!.id) {
      res.status(400).json({
        error: "Cannot change your own role",
        code: "SELF_ROLE_CHANGE",
      });
      return;
    }

    if (!UUID_RE.test(userId)) {
      res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    validateReassignmentMapInput(reassignmentMap);

    const result = await changeUserRole(
      userId,
      role as Role,
      req.user!.id,
      reassignmentMap,
    );
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    if (error instanceof AccountTransitionError) {
      const status = accountTransitionStatus(error);
      res.status(status).json({
        error: error.message,
        code: error.code,
        ...(error.details ?? {}),
      });
      return;
    }

    const message =
      error instanceof Error ? error.message : "Failed to update user role";
    const status = message === "User not found" ? 404 : 500;
    res.status(status).json({ error: message });
  }
}

/**
 * GET /api/admin/users/:id/role-transition-preview?role=STUDENT
 * Return the read-only impact needed for an exact reassignment map.
 */
export async function getRoleTransitionPreview(req: Request, res: Response) {
  try {
    const userId = req.params.id as string;
    const requestedRole = typeof req.query.role === "string" ? req.query.role : undefined;
    if (!requestedRole || !ADMIN_ROLES.includes(requestedRole)) {
      res.status(400).json({
        error: "Role must be one of STUDENT, EXAMINER, ADMIN",
        code: "INVALID_ROLE",
      });
      return;
    }
    if (!userId || !UUID_RE.test(userId)) {
      res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    const data = await previewUserRoleTransition(
      userId,
      requestedRole as Role,
      req.user!.id,
    );
    res.status(200).json({ status: "success", data });
  } catch (error) {
    if (error instanceof AccountTransitionError) {
      const status = accountTransitionStatus(error);
      res.status(status).json({
        error: error.message,
        code: error.code,
        ...(error.details ?? {}),
      });
      return;
    }
    res.status(500).json({ error: "Failed to preview role transition" });
  }
}

/**
 * GET /api/admin/examiners
 * List examiners with their open assignment counts.
 */
export async function getExaminers(req: Request, res: Response) {
  try {
    const items = await listAdminExaminers();
    res.status(200).json({
      status: "success",
      data: { items },
    });
  } catch (error) {
    console.error("List examiners error:", error);
    res.status(500).json({ error: "Failed to load examiners" });
  }
}

/**
 * POST /api/admin/submissions/:id/assign
 * Assign examiners to a PAID submission.
 */
export async function assignSubmission(req: Request, res: Response) {
  try {
    const submissionId = req.params.id as string;
    if (!submissionId) {
      res.status(400).json({ error: "Submission ID is required" });
      return;
    }

    const result = await assignExaminers(submissionId);
    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    if (error instanceof AssignmentSetError) {
      // Approved mapping: missing Submission → 404; non-Assignment-ready,
      // insufficient capacity, and invariant corruption → distinct 409 codes;
      // exhausted contention → retryable 503.
      const status =
        error.code === "SUBMISSION_NOT_FOUND"
          ? 404
          : error.code === "ASSIGNMENT_BUSY"
            ? 503
            : 409;
      res.status(status).json({
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        ...(error.eligibleExaminerCount !== undefined
          ? { eligibleExaminerCount: error.eligibleExaminerCount }
          : {}),
      });
      return;
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({ error: "Examiners already assigned" });
      return;
    }

    const message =
      error instanceof Error ? error.message : "Failed to assign examiners";
    const status =
      message === "Submission not found"
        ? 404
        : message === "Examiners already assigned"
          ? 409
          : message === "Submission must be in PAID status" ||
              message === "No examiners available" ||
              message.startsWith("No examiners available")
            ? 400
            : 500;
    res.status(status).json({ error: message });
  }
}

/**
 * GET /api/admin/submissions
 * List submissions with pagination and optional status filtering.
 */
export async function listSubmissions(req: Request, res: Response) {
  try {
    const pageRaw = Number(req.query.page ?? 1);
    if (!Number.isInteger(pageRaw) || pageRaw < 1) {
      res.status(400).json({ error: "page must be a positive integer" });
      return;
    }
    const page = pageRaw;

    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(100, Math.max(1, Math.trunc(limitRaw)))
      : 20;

    let status: SubmissionStatus | undefined;
    if (req.query.status !== undefined) {
      const rawStatus = String(req.query.status);
      if (!ADMIN_SUBMISSION_STATUSES.includes(rawStatus)) {
        res.status(400).json({
          error: `status must be one of ${ADMIN_SUBMISSION_STATUSES.join(", ")}`,
        });
        return;
      }
      status = rawStatus as SubmissionStatus;
    }

    const data = await listAdminSubmissions({ page, limit, status });

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("List submissions error:", error);
    res.status(500).json({ error: "Failed to load submissions" });
  }
}

/**
 * GET /api/admin/submissions/:id
 * Fetch a complete read-only submission view for an admin.
 */
export async function getSubmission(req: Request, res: Response) {
  const submissionId = req.params.id as string;
  if (!submissionId || !UUID_RE.test(submissionId)) {
    res.status(400).json({ error: "A valid submission ID is required" });
    return;
  }

  try {
    const data = await getAdminSubmissionDetail(submissionId);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load submission";
    if (message === "Submission not found") {
      res.status(404).json({ error: message });
      return;
    }

    console.error("Get submission detail error:", error);
    res.status(500).json({ error: "Failed to load submission" });
  }
}

/**
 * GET /api/admin/stats
 * Aggregate dashboard statistics.
 */
export async function getStats(req: Request, res: Response) {
  try {
    const stats = await getAdminStats();
    res.status(200).json({
      status: "success",
      data: stats,
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ error: "Failed to load stats" });
  }
}

/**
 * GET /api/admin/settings
 * Fetch global platform settings.
 */
export async function getSettings(req: Request, res: Response) {
  try {
    const settings = await getAppSettings();
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).json({
      status: "success",
      data: settings,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    res.status(500).json({ error: "Failed to load settings" });
  }
}

/**
 * PUT /api/admin/settings
 * Update global platform settings.
 */
export async function updateSettings(req: Request, res: Response) {
  const { paymentEnabled } = req.body as { paymentEnabled?: unknown };
  if (typeof paymentEnabled !== "boolean") {
    res.status(400).json({ error: "paymentEnabled must be a boolean" });
    return;
  }

  try {
    const settings = await updatePaymentEnabled(paymentEnabled);
    res.status(200).json({
      status: "success",
      data: settings,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
}

function retentionErrorStatus(error: RetentionOperationError): number {
  switch (error.code) {
    case "SUBMISSION_NOT_FOUND":
    case "PURGE_REQUEST_NOT_FOUND":
    case "HOLD_NOT_FOUND":
      return 404;
    case "ACTIVE_ADMIN_REQUIRED":
      return 403;
    case "RETENTION_CLEANUP_DISABLED":
      return 503;
    case "PURGE_NOT_ELIGIBLE":
    case "DUAL_CONTROL_REQUIRED":
    case "PURGE_NOT_APPROVED":
    case "PURGE_QUARANTINE_ACTIVE":
    case "PURGE_NOT_RECOVERABLE":
    case "PURGE_IRREVERSIBLE":
    case "PURGE_DELETE_IN_FLIGHT":
      return 409;
    default:
      return 400;
  }
}

function retentionErrorResponse(res: Response, error: unknown): void {
  if (error instanceof RetentionOperationError) {
    res.status(retentionErrorStatus(error)).json({
      error: error.message,
      code: error.code,
      ...(error.details ?? {}),
    });
    return;
  }
  res.status(500).json({ error: "Retention operation failed" });
}

function retentionBody(req: Request): {
  reason?: unknown;
  authorizationId?: unknown;
  type?: unknown;
} {
  return req.body as {
    reason?: unknown;
    authorizationId?: unknown;
    type?: unknown;
  };
}

function requiredReason(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** POST /api/admin/submissions/:id/purge-request */
export async function requestPurge(req: Request, res: Response) {
  const submissionId = req.params.id as string;
  const body = retentionBody(req);
  const reason = requiredReason(body.reason);
  if (!UUID_RE.test(submissionId) || !reason) {
    res.status(400).json({ error: "A valid Submission ID and non-empty reason are required" });
    return;
  }
  try {
    const data = await requestSubmissionPurge(
      submissionId,
      req.user!.id,
      {
        reason,
        ...(typeof body.authorizationId === "string" ? { authorizationId: body.authorizationId } : {}),
      },
    );
    res.status(201).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}

/** POST /api/admin/submissions/purge-requests/:id/approve */
export async function approvePurge(req: Request, res: Response) {
  const requestId = req.params.id as string;
  const body = retentionBody(req);
  const reason = requiredReason(body.reason);
  if (!UUID_RE.test(requestId) || !reason) {
    res.status(400).json({ error: "A valid purge request ID and non-empty reason are required" });
    return;
  }
  try {
    const data = await approveSubmissionPurge(requestId, req.user!.id, {
      reason,
      ...(typeof body.authorizationId === "string" ? { authorizationId: body.authorizationId } : {}),
    });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}

/** POST /api/admin/submissions/purge-requests/:id/cancel */
export async function cancelPurge(req: Request, res: Response) {
  const requestId = req.params.id as string;
  const body = retentionBody(req);
  const reason = requiredReason(body.reason);
  if (!UUID_RE.test(requestId) || !reason) {
    res.status(400).json({ error: "A valid purge request ID and non-empty reason are required" });
    return;
  }
  try {
    const data = await cancelSubmissionPurge(requestId, req.user!.id, {
      reason,
      ...(typeof body.authorizationId === "string" ? { authorizationId: body.authorizationId } : {}),
    });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}

/** POST /api/admin/submissions/purge-requests/:id/finalize */
export async function finalizePurge(req: Request, res: Response) {
  const requestId = req.params.id as string;
  const body = retentionBody(req);
  const reason = requiredReason(body.reason);
  const authorizationId = typeof body.authorizationId === "string" ? body.authorizationId : undefined;
  if (!UUID_RE.test(requestId) || !reason || !authorizationId?.trim()) {
    res.status(400).json({ error: "A valid purge request ID, authorization ID, and non-empty reason are required" });
    return;
  }
  try {
    const data = await finalizeSubmissionPurge(requestId, req.user!.id, {
      reason,
      authorizationId,
    });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}

/** GET /api/admin/submissions/purge-requests/:id */
export async function getPurgeRequest(req: Request, res: Response) {
  const requestId = req.params.id as string;
  if (!UUID_RE.test(requestId)) {
    res.status(400).json({ error: "A valid purge request ID is required" });
    return;
  }
  try {
    const data = await getSubmissionPurgeRequest(requestId);
    if (!data) {
      res.status(404).json({ error: "Purge request not found" });
      return;
    }
    res.status(200).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}

/** POST /api/admin/submissions/:id/retention-holds */
export async function addRetentionHold(req: Request, res: Response) {
  const submissionId = req.params.id as string;
  const body = retentionBody(req);
  const reason = requiredReason(body.reason);
  const types = ["LEGAL", "DISPUTE", "PAYMENT", "SCORING_REVIEW", "RECOVERY", "CERTIFICATE", "ADMIN"] as const;
  if (!UUID_RE.test(submissionId) || !reason || typeof body.type !== "string" || !types.includes(body.type as (typeof types)[number])) {
    res.status(400).json({ error: "A valid Submission ID, hold type, and non-empty reason are required" });
    return;
  }
  try {
    const data = await createRetentionHold(submissionId, req.user!.id, body.type as (typeof types)[number], reason);
    res.status(201).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}

/** POST /api/admin/retention-holds/:id/release */
export async function releaseHold(req: Request, res: Response) {
  const holdId = req.params.id as string;
  const reason = requiredReason(retentionBody(req).reason);
  if (!UUID_RE.test(holdId) || !reason) {
    res.status(400).json({ error: "A valid hold ID and non-empty reason are required" });
    return;
  }
  try {
    const data = await releaseRetentionHold(holdId, req.user!.id, reason);
    res.status(200).json({ status: "success", data });
  } catch (error) {
    retentionErrorResponse(res, error);
  }
}
