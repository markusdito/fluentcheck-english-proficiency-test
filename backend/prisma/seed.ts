import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/client.js";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ["error", "warn"],
});

async function main() {
  console.log("🌱 Starting seed...");

  // Clean existing seed data
  await prisma.score.deleteMany();
  await prisma.examinerAssignment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.task.deleteMany();
  await prisma.question.deleteMany();

  // Find or create an admin user to be the creator of questions
  let admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        username: "admin",
        email: "admin@fluentcheck.com",
        password: "$2a$10$placeholder", // placeholder — not a real hash, for seed only
        role: "ADMIN",
      },
    });
    console.log(`👤 Created admin user: ${admin.id}`);
  } else {
    console.log(`👤 Using existing admin: ${admin.id}`);
  }

  // ──────────────────────────────────────────────
  // PART 1 — Introduction & Interview (3 questions, 5+ tasks each)
  // ──────────────────────────────────────────────
  const part1Questions = [
    {
      category: "PART_1" as const,
      promptText: "Work and Studies",
      order: 1,
      preparationSeconds: 20,
      recordingSeconds: 60,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "What do you do — are you a student or do you work?",
            order: 1,
          },
          {
            promptText: "Why did you choose that field of study or career path?",
            order: 2,
          },
          {
            promptText: "What do you enjoy most about your studies or job?",
            order: 3,
          },
          {
            promptText: "Do you plan to continue in this field in the future? Why or why not?",
            order: 4,
          },
          {
            promptText: "What skills do you think are most important for success in your field?",
            order: 5,
          },
        ],
      },
    },
    {
      category: "PART_1" as const,
      promptText: "Home and Hometown",
      order: 2,
      preparationSeconds: 20,
      recordingSeconds: 60,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "Can you describe the area or neighborhood where you live?",
            order: 1,
          },
          {
            promptText: "What is your favorite room in your home, and why?",
            order: 2,
          },
          {
            promptText: "How long have you lived there, and do you like it?",
            order: 3,
          },
          {
            promptText: "What changes would you make to your home if you could?",
            order: 4,
          },
          {
            promptText: "How has your hometown changed since you were a child?",
            order: 5,
          },
        ],
      },
    },
    {
      category: "PART_1" as const,
      promptText: "Hobbies and Free Time",
      order: 3,
      preparationSeconds: 20,
      recordingSeconds: 60,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "What do you enjoy doing in your free time?",
            order: 1,
          },
          {
            promptText: "How often do you engage in this hobby, and with whom?",
            order: 2,
          },
          {
            promptText: "Why is it important for people to have hobbies?",
            order: 3,
          },
          {
            promptText: "Have you taken up any new hobbies recently? What inspired you?",
            order: 4,
          },
          {
            promptText: "Do you prefer spending your free time alone or with others? Why?",
            order: 5,
          },
          {
            promptText: "What hobby would you like to try in the future if you had more time?",
            order: 6,
          },
        ],
      },
    },
  ];

  // ──────────────────────────────────────────────
  // PART 2 — Individual Long Turn (2 questions, 5+ tasks each)
  // ──────────────────────────────────────────────
  const part2Questions = [
    {
      category: "PART_2" as const,
      promptText: "Describe a memorable journey you have taken",
      order: 4,
      preparationSeconds: 60,
      recordingSeconds: 120,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "Where did you go and when did this journey take place?",
            order: 1,
          },
          {
            promptText: "Who accompanied you on this journey?",
            order: 2,
          },
          {
            promptText: "What happened during the journey that made it memorable?",
            order: 3,
          },
          {
            promptText: "How did you feel before, during, and after the journey?",
            order: 4,
          },
          {
            promptText: "What did you learn or gain from this experience?",
            order: 5,
          },
          {
            promptText: "Would you recommend this journey to others? Why or why not?",
            order: 6,
          },
        ],
      },
    },
    {
      category: "PART_2" as const,
      promptText: "Describe a valuable skill you have learned",
      order: 5,
      preparationSeconds: 60,
      recordingSeconds: 120,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "What is the skill and how did you first become interested in it?",
            order: 1,
          },
          {
            promptText: "How did you go about learning this skill — what steps did you take?",
            order: 2,
          },
          {
            promptText: "What challenges or difficulties did you face while learning it?",
            order: 3,
          },
          {
            promptText: "How long did it take you to become proficient?",
            order: 4,
          },
          {
            promptText: "How has this skill benefited you in your personal or professional life?",
            order: 5,
          },
          {
            promptText: "What advice would you give to someone who wants to learn this skill?",
            order: 6,
          },
        ],
      },
    },
  ];

  // ──────────────────────────────────────────────
  // PART 3 — Two-way Discussion (3 questions, 5+ tasks each)
  // ──────────────────────────────────────────────
  const part3Questions = [
    {
      category: "PART_3" as const,
      promptText: "Travel and Cultural Exchange",
      order: 6,
      preparationSeconds: 30,
      recordingSeconds: 90,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "Why do you think people are drawn to travel and explore new places?",
            order: 1,
          },
          {
            promptText: "What are the main benefits of experiencing different cultures?",
            order: 2,
          },
          {
            promptText: "How has technology changed the way people travel today compared to the past?",
            order: 3,
          },
          {
            promptText: "Do you think tourism has more positive or negative impacts on local communities? Explain.",
            order: 4,
          },
          {
            promptText: "What role should governments play in promoting sustainable tourism?",
            order: 5,
          },
        ],
      },
    },
    {
      category: "PART_3" as const,
      promptText: "Learning and Education in the Modern Era",
      order: 7,
      preparationSeconds: 30,
      recordingSeconds: 90,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "How has the way people access education changed in the last decade?",
            order: 1,
          },
          {
            promptText: "Do you believe online learning can replace traditional classroom education? Why or why not?",
            order: 2,
          },
          {
            promptText: "What subjects do you think should be emphasized more in school curricula today?",
            order: 3,
          },
          {
            promptText: "How important is lifelong learning in today's rapidly changing job market?",
            order: 4,
          },
          {
            promptText: "What role do you think artificial intelligence will play in education in the future?",
            order: 5,
          },
          {
            promptText: "How can we ensure equal access to quality education for people around the world?",
            order: 6,
          },
        ],
      },
    },
    {
      category: "PART_3" as const,
      promptText: "Society, Technology, and Change",
      order: 8,
      preparationSeconds: 30,
      recordingSeconds: 90,
      createdById: admin.id,
      tasks: {
        create: [
          {
            promptText: "In what ways has technology most significantly changed daily life?",
            order: 1,
          },
          {
            promptText: "Do you think people today are more or less connected than in the past? Explain.",
            order: 2,
          },
          {
            promptText: "What are the biggest challenges facing society today?",
            order: 3,
          },
          {
            promptText: "How do you think urbanization and city growth will shape future generations?",
            order: 4,
          },
          {
            promptText: "What is the role of the younger generation in driving social change?",
            order: 5,
          },
          {
            promptText: "Do you believe technology will ultimately bring people together or drive them apart? Why?",
            order: 6,
          },
        ],
      },
    },
  ];

  const allQuestions = [...part1Questions, ...part2Questions, ...part3Questions];

  console.log(`📝 Creating ${allQuestions.length} questions with tasks...`);

  for (const q of allQuestions) {
    const created = await prisma.question.create({
      data: q,
      include: { tasks: true },
    });
    console.log(`  ✅ Created: [${created.category}] "${created.promptText}" — ${created.tasks.length} tasks`);
  }

  console.log("\n🎉 Seed completed successfully!");
  console.log(`   Total questions: ${allQuestions.length}`);
  const totalTasks = allQuestions.reduce((sum, q) => sum + q.tasks.create.length, 0);
  console.log(`   Total tasks: ${totalTasks}`);
}

main()
    .catch((e) => {
      console.error("❌ Seed failed:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });