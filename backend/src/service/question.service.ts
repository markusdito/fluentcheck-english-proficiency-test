import {prisma} from "../config/db.js";
import {QuestionCategory} from "../generated/enums.js";

export interface CreateTaskInput {
  promptText: string;
  order: number;
}

export interface CreateQuestionInput {
  category: QuestionCategory;
  order: number;
  preparationSeconds?: number;
  recordingSeconds?: number;
  tasks?: CreateTaskInput[];
}

export interface UpdateQuestionInput {
  category?: QuestionCategory;
  order?: number;
  preparationSeconds?: number;
  recordingSeconds?: number;
}

export interface UpdateTaskInput {
  promptText?: string;
  order?: number;
}

/**
 * Retrieve one random question per category (PART_1, PART_2, PART_3)
 * with their tasks, sorted by order.
 */
export async function retrieveQuestions(order: number) {
  const categories = [
    QuestionCategory.PART_1,
    QuestionCategory.PART_2,
    QuestionCategory.PART_3,
  ];

  // Fetch all non-deleted questions across the three categories
  return prisma.question.findMany({
    where: {deletedAt: null, category: {in: categories}, order: order},
    select: {
      id: true,
      category: true,
      order: true,
      preparationSeconds: true,
      recordingSeconds: true,
      audioStorageKey: true,
      audioMimeType: true,
      audioUploadStatus: true,
      tasks: {
        where: {deletedAt: null},
        orderBy: {order: "asc"},
        select: {
          id: true,
          promptText: true,
          order: true,
        },
      },
    },
  });
}

/**
 * Retrieve every active question for the admin question bank.
 * Draft questions are intentionally included so admins can finish their audio.
 */
export async function retrieveAdminQuestions() {
  const categories = [
    QuestionCategory.PART_1,
    QuestionCategory.PART_2,
    QuestionCategory.PART_3,
  ];

  return prisma.question.findMany({
    where: {deletedAt: null, category: {in: categories}},
    orderBy: [{category: "asc"}, {order: "asc"}],
    select: {
      id: true,
      category: true,
      order: true,
      preparationSeconds: true,
      recordingSeconds: true,
      audioStorageKey: true,
      audioMimeType: true,
      audioSizeBytes: true,
      audioUploadStatus: true,
      createdAt: true,
      tasks: {
        where: {deletedAt: null},
        orderBy: {order: "asc"},
        select: {
          id: true,
          promptText: true,
          order: true,
        },
      },
    },
  });
}

/**
 * Retrieve only questions that are ready to be delivered to test takers.
 */
export async function retrieveTestQuestions(order: number) {
  const categories = [
    QuestionCategory.PART_1,
    QuestionCategory.PART_2,
    QuestionCategory.PART_3,
  ];

  return prisma.question.findMany({
    where: {
      deletedAt: null,
      category: {in: categories},
      order,
      audioUploadStatus: "UPLOADED",
    },
    select: {
      id: true,
      category: true,
      order: true,
      preparationSeconds: true,
      recordingSeconds: true,
      audioStorageKey: true,
      audioMimeType: true,
      audioUploadStatus: true,
      tasks: {
        where: {deletedAt: null},
        orderBy: {order: "asc"},
        select: {
          id: true,
          promptText: true,
          order: true,
        },
      },
    },
  });
}

/**
 * Create a question and its nested tasks (admin only).
 */
export async function createQuestion(userId: string, data: CreateQuestionInput) {
  return prisma.question.create({
    data: {
      category: data.category,
      order: data.order,
      preparationSeconds: data.preparationSeconds ?? 30,
      recordingSeconds: data.recordingSeconds ?? 120,
      createdById: userId,
      tasks: data.tasks?.length
        ? {create: data.tasks.map((task) => ({promptText: task.promptText, order: task.order}))}
        : undefined,
    },
    include: {
      tasks: {
        where: {deletedAt: null},
        orderBy: {order: "asc"},
      },
    },
  });
}

/**
 * Update a question's scalar fields (admin only). Tasks are not touched here.
 */
export async function updateQuestion(id: string, data: UpdateQuestionInput) {
  const existing = await prisma.question.findUnique({
    where: {id},
    select: {id: true, deletedAt: true},
  });
  if (!existing || existing.deletedAt) throw new Error("Question not found");

  return prisma.question.update({
    where: {id},
    data: {
      ...(data.category !== undefined && {category: data.category}),
      ...(data.order !== undefined && {order: data.order}),
      ...(data.preparationSeconds !== undefined && {preparationSeconds: data.preparationSeconds}),
      ...(data.recordingSeconds !== undefined && {recordingSeconds: data.recordingSeconds}),
    },
    include: {
      tasks: {
        where: {deletedAt: null},
        orderBy: {order: "asc"},
      },
    },
  });
}

/**
 * Retire a Question from future delivery without mutating retained evidence.
 */
export async function retireQuestion(id: string) {
  const existing = await prisma.question.findUnique({
    where: {id},
    select: {id: true, deletedAt: true},
  });
  if (!existing) throw new Error("Question not found");
  if (!existing.deletedAt) {
    await prisma.question.updateMany({
      where: {id, deletedAt: null},
      data: {deletedAt: new Date()},
    });
  }

  return prisma.question.findUniqueOrThrow({where: {id}});
}

/**
 * Create a task under an active (non-deleted) question.
 */
export async function createTask(questionId: string, data: CreateTaskInput) {
  const question = await prisma.question.findUnique({
    where: {id: questionId},
    select: {id: true, deletedAt: true},
  });
  if (!question || question.deletedAt) throw new Error("Question not found");

  return prisma.task.create({
    data: {
      questionId,
      promptText: data.promptText,
      order: data.order,
    },
  });
}

/**
 * Update a task belonging to the given question.
 */
export async function updateTask(questionId: string, taskId: string, data: UpdateTaskInput) {
  const task = await prisma.task.findUnique({
    where: {id: taskId},
    select: {id: true, questionId: true, deletedAt: true},
  });
  if (!task || task.deletedAt) throw new Error("Task not found");
  if (task.questionId !== questionId) throw new Error("Task not found");

  return prisma.task.update({
    where: {id: taskId},
    data: {
      ...(data.promptText !== undefined && {promptText: data.promptText}),
      ...(data.order !== undefined && {order: data.order}),
    },
  });
}

/**
 * Soft delete a task belonging to the given question.
 */
export async function deleteTask(questionId: string, taskId: string) {
  const task = await prisma.task.findUnique({
    where: {id: taskId},
    select: {id: true, questionId: true, deletedAt: true},
  });
  if (!task || task.deletedAt) throw new Error("Task not found");
  if (task.questionId !== questionId) throw new Error("Task not found");

  return prisma.task.update({
    where: {id: taskId},
    data: {deletedAt: new Date()},
  });
}
