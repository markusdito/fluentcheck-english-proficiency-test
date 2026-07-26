import { retrieveQuestions } from "../service/question.service.js";
export async function getQuestions(req, res) {
    try {
        const questions = await retrieveQuestions(2);
        res.status(200).json({
            status: "success",
            data: questions,
        });
    }
    catch (error) {
        console.error("Error fetching questions:", error);
        res.status(500).json({ error: "Failed to fetch questions" });
    }
}
