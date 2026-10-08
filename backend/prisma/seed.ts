import "dotenv/config";
import { randomUUID } from "node:crypto";
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
  await prisma.testSet.deleteMany();

  // Find or create an admin user to be the creator of questions
  let admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        username: "admin",
        email: "admin@fluentcheck.com",
        normalizedEmail: "admin@fluentcheck.com",
        password: "$2a$10$placeholder", // placeholder — not a real hash, for seed only
        role: "ADMIN",
      },
    });
    console.log(`👤 Created admin user: ${admin.id}`);
  } else {
    console.log(`👤 Using existing admin: ${admin.id}`);
  }

  // ──────────────────────────────────────────────
  // EXAMINERS
  // ──────────────────────────────────────────────
  const examinerData = [
    { username: "examiner_sarah", email: "sarah@fluentcheck.com" },
    { username: "examiner_mike", email: "mike@fluentcheck.com" },
  ];

  for (const ex of examinerData) {
    const existing = await prisma.user.findFirst({ where: { email: ex.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          ...ex,
          normalizedEmail: ex.email,
          password: "$2a$10$placeholder",
          role: "EXAMINER",
        },
      });
      console.log(`👤 Created examiner user: ${ex.email}`);
    } else {
      console.log(`👤 Using existing examiner: ${ex.email}`);
    }
  }

  // ──────────────────────────────────────────────
  // DEMO TEST SET — one Question per delivery slot with PRD default timings.
  // The full CEFR B1 Test Sets A–F are loaded separately.
  // ──────────────────────────────────────────────
  const testSet = await prisma.testSet.create({ data: { code: "DEMO" } });
  const demoQuestions = [
    {
      category: "PART_1A" as const,
      preparationSeconds: 10,
      recordingSeconds: 45,
      tasks: ["Task 1A: Describe your plans for the next five years."],
    },
    {
      category: "PART_1B" as const,
      preparationSeconds: 10,
      recordingSeconds: 45,
      tasks: ["Task 1B: Explain how English is useful in your daily life."],
    },
    {
      category: "PART_2" as const,
      preparationSeconds: 60,
      recordingSeconds: 90,
      tasks: ["Talk about a community action you took part in or would like to start."],
      cueCard: {
        topic: "A community action you took part in or would like to start",
        points: [
          "What the action was and who was involved",
          "Why it mattered to you",
          "What you would do differently next time",
        ],
      },
    },
    {
      category: "PART_3" as const,
      preparationSeconds: 60,
      recordingSeconds: 90,
      tasks: ["Look at the four graduation project options. Select the ONE option you prefer and explain why."],
      options: [
        { title: "Research paper", bullets: ["Deep study of one topic", "Works alone"] },
        { title: "Community project", bullets: ["Helps local people", "Needs teamwork"] },
        { title: "Internship report", bullets: ["Real work experience", "Depends on a company"] },
        { title: "Start-up prototype", bullets: ["Builds a product", "High risk"] },
      ],
    },
    {
      category: "PART_4" as const,
      preparationSeconds: 15,
      recordingSeconds: 60,
      tasks: ["Task 4: Express your opinion on vocational skills versus a university degree."],
    },
  ];

  console.log(`📝 Creating Test Set ${testSet.code} with ${demoQuestions.length} questions...`);

  for (const q of demoQuestions) {
    const created = await prisma.question.create({
      data: {
        category: q.category,
        testSetId: testSet.id,
        preparationSeconds: q.preparationSeconds,
        recordingSeconds: q.recordingSeconds,
        createdById: admin.id,
        tasks: {
          create: q.tasks.map((promptText, index) => ({ promptText, order: index + 1 })),
        },
      },
      include: { tasks: true },
    });
    await prisma.question.update({
      where: { id: created.id },
      data: {
        audioStorageKey: `questions/${created.id}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 1,
        audioUploadStatus: "UPLOADED",
        ...("cueCard" in q && { cueCard: q.cueCard }),
        // Like the prompt audio above, demo icon identities are placeholders.
        ...("options" in q && {
          options: q.options.map((option, index) => ({
            ...option,
            icon: {
              storageKey: `questions/${created.id}/options/${index}/${randomUUID()}.png`,
              mimeType: "image/png",
              sizeBytes: 1,
            },
          })),
        }),
      },
    });
    console.log(`  ✅ Created: [${testSet.code}/${created.category}] — ${created.tasks.length} tasks`);
  }

  console.log("\n🎉 Seed completed successfully!");
  console.log(`   Total questions: ${demoQuestions.length}`);
}

main()
    .catch((e) => {
      console.error("❌ Seed failed:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
