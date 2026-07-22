import { Router } from "express";
import {register, login, logout, getMe} from "../controllers/auth.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/register", register)
router.post("/login", login)
router.post("/logout", logout)
router.get("/me", verifyToken, getMe)

export default router;
