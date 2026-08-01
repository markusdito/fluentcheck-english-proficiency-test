import type { Request, Response } from "express";
import {
  listAdminUsers,
  changeUserRole,
  listAdminExaminers,
  assignExaminers,
} from "../service/admin.service.js";
import { Role } from "../generated/enums.js";
import { Prisma } from "../generated/client.js";

const ADMIN_ROLES: readonly string[] = ["STUDENT", "EXAMINER", "ADMIN"];

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

    const { role } = req.body as { role?: unknown };
    if (typeof role !== "string" || !ADMIN_ROLES.includes(role)) {
      res
        .status(400)
        .json({ error: "role must be one of STUDENT, EXAMINER, ADMIN" });
      return;
    }

    if (userId === req.user!.id) {
      res.status(400).json({ error: "Cannot change your own role" });
      return;
    }

    const user = await changeUserRole(userId, role as Role);
    res.status(200).json({
      status: "success",
      data: { user },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update user role";
    const status =
      message === "User not found"
        ? 404
        : message === "Cannot demote the last admin"
          ? 400
          : 500;
    res.status(status).json({ error: message });
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

    const assignedExaminers = await assignExaminers(submissionId);
    res.status(200).json({
      status: "success",
      data: { assignedExaminers },
    });
  } catch (error) {
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
        : message === "Submission must be in PAID status" ||
            message === "No examiners available" ||
            message.startsWith("No examiners available")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
}

