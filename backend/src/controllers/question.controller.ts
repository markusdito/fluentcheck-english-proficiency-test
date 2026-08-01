import type { Request, Response } from "express";
import { Prisma } from "../generated/client.js";
import { QuestionCategory } from "../generated/enums.js";
import {
  retrieveQuestions,
  createQuestion as createQuestionService,
  updateQuestion as updateQuestionService,
  deleteQuestion as deleteQuestionService,
  createTask as createTaskService,
  updateTask as updateTaskService,
  deleteTask as deleteTaskService,
} from "../service/question.service.js";

function isQuestionCategory(value: unknown): value is QuestionCategory {
  return (
    typeof value === "string" &&
    (Object.values(QuestionCategory) as string[]).includes(value)
  );
}

function handleQuestionError(res: Response, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    res.status(409).json({ error: "A question or task with the same order already exists" });
    return;
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  const status =
    message === "Question not found" || message === "Task not found" ? 404 : 500;
  res.status(status).json({ error: message });
}

export async function getQuestions(req: Request, res: Response) {
  try {
    const questions = await retrieveQuestions(2);
    res.status(200).json({
      status: "success",
      data: questions,
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
}

export async function createQuestion(req: Request, res: Response) {
  try {
    const { category, promptText, order, preparationSeconds, recordingSeconds, tasks } = req.body;

    if (!isQuestionCategory(category)) {
      res.status(400).json({ error: "Category must be one of PART_1, PART_2 or PART_3" });
      return;
    }
    if (typeof promptText !== "string" || promptText.trim() === "") {
      res.status(400).json({ error: "promptText is required" });
      return;
    }
    if (typeof order !== "number" || !Number.isInteger(order)) {
      res.status(400).json({ error: "order is required and must be an integer" });
      return;
    }
    if (tasks !== undefined) {
      if (!Array.isArray(tasks)) {
        res.status(400).json({ error: "tasks must be an array" });
        return;
      }
      for (const task of tasks) {
        if (
          typeof task?.promptText !== "string" ||
          task.promptText.trim() === "" ||
          typeof task.order !== "number" ||
          !Number.isInteger(task.order)
        ) {
          res.status(400).json({ error: "Each task requires promptText and order" });
          return;
        }
      }
    }

    const question = await createQuestionService(req.user!.id, {
      category,
      promptText: promptText.trim(),
      order,
      preparationSeconds,
      recordingSeconds,
      tasks,
    });

    res.status(201).json({ status: "success", data: question });
  } catch (error) {
    handleQuestionError(res, error);
  }
}

export async function updateQuestion(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const { category, promptText, order, preparationSeconds, recordingSeconds } = req.body;

    if (category !== undefined && !isQuestionCategory(category)) {
      res.status(400).json({ error: "Category must be one of PART_1, PART_2 or PART_3" });
      return;
    }
    if (promptText !== undefined && (typeof promptText !== "string" || promptText.trim() === "")) {
      res.status(400).json({ error: "promptText must be a non-empty string" });
      return;
    }
    if (order !== undefined && (typeof order !== "number" || !Number.isInteger(order))) {
      res.status(400).json({ error: "order must be an integer" });
      return;
    }
    if (preparationSeconds !== undefined && (typeof preparationSeconds !== "number" || !Number.isInteger(preparationSeconds))) {
      res.status(400).json({ error: "preparationSeconds must be an integer" });
      return;
    }
    if (recordingSeconds !== undefined && (typeof recordingSeconds !== "number" || !Number.isInteger(recordingSeconds))) {
      res.status(400).json({ error: "recordingSeconds must be an integer" });
      return;
    }

    const question = await updateQuestionService(id, {
      category,
      promptText: promptText?.trim(),
      order,
      preparationSeconds,
      recordingSeconds,
    });

    res.status(200).json({ status: "success", data: question });
  } catch (error) {
    handleQuestionError(res, error);
  }
}

export async function deleteQuestion(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    await deleteQuestionService(id);
    res.status(200).json({ status: "success" });
  } catch (error) {
    handleQuestionError(res, error);
  }
}

export async function createTask(req: Request, res: Response) {
  try {
    const questionId = req.params.id as string;
    const { promptText, order } = req.body;

    if (typeof promptText !== "string" || promptText.trim() === "") {
      res.status(400).json({ error: "promptText is required" });
      return;
    }
    if (typeof order !== "number" || !Number.isInteger(order)) {
      res.status(400).json({ error: "order is required and must be an integer" });
      return;
    }

    const task = await createTaskService(questionId, { promptText: promptText.trim(), order });
    res.status(201).json({ status: "success", data: task });
  } catch (error) {
    handleQuestionError(res, error);
  }
}

export async function updateTask(req: Request, res: Response) {
  try {
    const questionId = req.params.id as string;
    const taskId = req.params.taskId as string;
    const { promptText, order } = req.body;

    if (promptText !== undefined && (typeof promptText !== "string" || promptText.trim() === "")) {
      res.status(400).json({ error: "promptText must be a non-empty string" });
      return;
    }
    if (order !== undefined && (typeof order !== "number" || !Number.isInteger(order))) {
      res.status(400).json({ error: "order must be an integer" });
      return;
    }

    const task = await updateTaskService(questionId, taskId, {
      promptText: promptText?.trim(),
      order,
    });
    res.status(200).json({ status: "success", data: task });
  } catch (error) {
    handleQuestionError(res, error);
  }
}

export async function deleteTask(req: Request, res: Response) {
  try {
    const questionId = req.params.id as string;
    const taskId = req.params.taskId as string;
    await deleteTaskService(questionId, taskId);
    res.status(200).json({ status: "success" });
  } catch (error) {
    handleQuestionError(res, error);
  }
}
