import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  listUsers,
  updateUserRole,
  getExaminers,
  assignSubmission,
} from "../controllers/admin.controller.js";

const router = Router();

// All admin routes require authentication + ADMIN role
router.use(verifyToken, requireRole("ADMIN"));

router.get("/users", listUsers);
router.put("/users/:id/role", updateUserRole);
router.get("/examiners", getExaminers);
router.post("/submissions/:id/assign", assignSubmission);

export default router;
