import {prisma} from "../config/db.js";
import {QuestionCategory} from "../generated/enums.js";

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
    include: {
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