import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes.js";
import questionRoutes from "./routes/question.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import submissionRoutes from "./routes/submission.routes.js";
import examinerRoutes from "./routes/examiner.routes.js";
import { createPaymentRouter } from "./routes/payment.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { env } from "./config/env.js";
import type { IpaymuTransport } from "./service/ipaymu.transport.js";

export interface AppDependencies {
  ipaymuTransport?: IpaymuTransport;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    maxAge: 86400,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use("/api/auth", authRoutes);
  app.use("/api/questions", questionRoutes);
  app.use("/api/uploads", uploadRoutes);
  app.use("/api/submissions", submissionRoutes);
  app.use("/api/examiner", examinerRoutes);
  app.use("/api/payments", createPaymentRouter(dependencies.ipaymuTransport));
  app.use("/api/admin", adminRoutes);

  app.get("/", (_req, res) => {
    res.json({ message: "FluentCheck API" });
  });

  return app;
}
