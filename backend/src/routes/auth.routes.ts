import { Router } from "express";
import { register, login, logout, getMe } from "../controllers/auth.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";
import { validateAuthBody } from "../middleware/auth-validation.middleware.js";
import { loginSchema, registrationSchema } from "../schemas/auth.schema.js";

const router = Router();

router.post("/register", validateAuthBody(registrationSchema), register);
router.post("/login", validateAuthBody(loginSchema), login);
router.post("/logout", logout);
router.get("/me", verifyToken, getMe);

export default router;
