import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import "dotenv/config";
import authRoutes from "./routes/auth.routes.js";
import questionRoutes from "./routes/question.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import submissionRoutes from "./routes/submission.routes.js";
import examinerRoutes from "./routes/examiner.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import { connectDB, disconnectDB } from "./config/db.js";
connectDB();
const app = express();
const PORT = process.env.PORT || 5001;
app.use(cors({
    origin: "http://localhost:3000",
    credentials: true,
}));
//Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//Cookie parser middleware (needed by verifyToken middleware)
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/examiner", examinerRoutes);
app.use("/api/payments", paymentRoutes);
app.get("/", (req, res) => {
    res.json({
        message: "FluentCheck API"
    });
});
const server = app.listen(PORT, () => {
    console.log("Server started on port: " + PORT);
});
//unhandled promise rejections
process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection: ", err);
    server.close(async () => {
        await disconnectDB();
        process.exit(1);
    });
});
//handle uncaught exception
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception: ", err);
    server.close(async () => {
        await disconnectDB();
        process.exit(1);
    });
});
process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully");
    server.close(async () => {
        await disconnectDB();
        process.exit(0);
    });
});
