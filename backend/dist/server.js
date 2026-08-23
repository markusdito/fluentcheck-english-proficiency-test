import "dotenv/config";
import { connectDB, disconnectDB } from "./config/db.js";
import { createApp } from "./app.js";
connectDB();
const app = createApp();
const PORT = process.env.PORT || 5001;
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
