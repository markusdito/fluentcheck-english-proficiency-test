import { Router } from "express";
import { register, login } from "../controllers/auth.controller";

const router = Router();

console.log("auth routes file loaded");

router.post("/register", register)
router.post("/login", login)

export default router;