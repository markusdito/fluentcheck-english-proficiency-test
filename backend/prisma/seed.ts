import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/client.js";
import { Pool } from "pg";
import { env } from "../src/config/env.js";
import { r2Client } from "../src/config/r2.js";
import { generateOptionIconKey } from "../src/service/questionContent.js";
import { TEST_SETS, type SeedQuestion } from "./testSets.js";

const assetDir = join(dirname(fileURLToPath(import.meta.url)), "seed-assets");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ["error", "warn"],
});

async function main() {
  console.log("🌱 Starting seed...");

  // No cleanup: Submission manifests are immutable evidence (database
  // triggers), so the seed only adds missing records and is safe to re-run.

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
  // CEFR B1 TEST SETS A–F (PRD §3.3, FR-6.4). Prompt audio and option icons
  // are committed in prisma/seed-assets and uploaded to R2, so every set is
  // deliverable after seeding. Without R2 a Question stays a Draft until an
  // admin uploads its media, or the seed is re-run. An existing active
  // Question in a slot is kept as-is; only its missing media is uploaded.
  // ──────────────────────────────────────────────
  let drafts = 0;
  for (const set of TEST_SETS) {
    const testSet = await prisma.testSet.upsert({
      where: { code: set.code },
      update: {},
      create: { code: set.code },
    });
    for (const q of set.questions) {
      const existing = await prisma.question.findFirst({
        where: { testSetId: testSet.id, category: q.category, deletedAt: null },
      });
      if (existing?.audioUploadStatus === "UPLOADED") {
        console.log(`  ⏭️  [${set.code}/${q.category}] already seeded`);
        continue;
      }
      const created = existing ?? await prisma.question.create({
        data: {
          category: q.category,
          testSetId: testSet.id,
          preparationSeconds: q.preparationSeconds,
          recordingSeconds: q.recordingSeconds,
          createdById: admin.id,
          ...(q.cueCard && { cueCard: q.cueCard }),
          ...(q.options && {
            options: q.options.map(({ title, bullets }) => ({ title, bullets, icon: null })),
          }),
          tasks: { create: q.tasks.map((promptText, index) => ({ promptText, order: index + 1 })) },
        },
      });
      try {
        await prisma.question.update({
          where: { id: created.id },
          data: await uploadSeedMedia(set.code, created.id, q),
        });
        console.log(`  ✅ [${set.code}/${q.category}] deliverable`);
      } catch (error) {
        drafts += 1;
        console.warn(`  ⚠️  [${set.code}/${q.category}] Draft, media upload failed: ${(error as Error).message}`);
      }
    }
  }

  console.log("\n🎉 Seed completed successfully!");
  console.log(`   Test Sets: ${TEST_SETS.map((set) => set.code).join(", ")}`);
  if (drafts > 0) {
    console.log(`   ${drafts} Question(s) are Drafts: check R2 settings and re-run, or upload media in the admin question bank.`);
  }
}

async function put(storageKey: string, file: string, mimeType: string) {
  const body = readFileSync(join(assetDir, file));
  await r2Client.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey, Body: body, ContentType: mimeType }),
  );
  return body.length;
}

/** Upload the committed prompt audio and option icons; returns the Question's media fields. */
async function uploadSeedMedia(setCode: string, questionId: string, q: SeedQuestion) {
  const audioStorageKey = `questions/${questionId}/prompt.mp3`;
  const audioSizeBytes = await put(audioStorageKey, `audio/${setCode}-${q.category}.mp3`, "audio/mpeg");
  const options = q.options && await Promise.all(q.options.map(async ({ title, bullets, icon }, index) => {
    const storageKey = generateOptionIconKey(questionId, index, randomUUID(), "image/png");
    const sizeBytes = await put(storageKey, `icons/${icon}.png`, "image/png");
    return { title, bullets, icon: { storageKey, mimeType: "image/png", sizeBytes } };
  }));
  return {
    audioStorageKey,
    audioMimeType: "audio/mpeg",
    audioSizeBytes,
    audioUploadStatus: "UPLOADED" as const,
    ...(options && { options }),
  };
}

main()
    .catch((e) => {
      console.error("❌ Seed failed:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
