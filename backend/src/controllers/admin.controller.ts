import type { Request, Response } from "express";
import { listAdminUsers } from "../service/admin.service.js";
import { Role } from "../generated/enums.js";

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
