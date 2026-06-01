import express from 'express';
import cors from 'cors';
import "dotenv/config";
import authRoutes from "./routes/auth.routes";

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors())
app.use(express.json())

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "FluentCheck API"
    })
})

const server = app.listen(PORT, () => {
    console.log("Server started on port: " + PORT);
})
