import { prisma } from "../src/config/db.js";
import { randomBytes } from "crypto";
import {
  createQuestionAudioPresignedUpload,
  confirmQuestionAudioUpload,
  createQuestionAudioViewUrl,
  AUDIO_KEY_RE,
  AUDIO_MIME_RE,
} from "../src/service/upload.service.js";
import { createQuestion, deleteQuestion } from "../src/service/question.service.js";
import { QuestionCategory } from "../src/generated/enums.js";

let failures = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    failures++;
  }
}

async function expectThrows(fn: () => Promise<unknown>, re: RegExp, label: string) {
  try {
    await fn();
    console.error(`FAIL: ${label} — did not throw`);
    failures++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(`${label} → "${msg}"`, re.test(msg));
  }
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No admin user in DB — run seed first");

  check("AUDIO_KEY_RE rejects traversal/tampered keys", !AUDIO_KEY_RE.test("submissions/x/answers/y.webm"));
  check("AUDIO_KEY_RE rejects ../", !AUDIO_KEY_RE.test("questions/../prompt.webm"));
  check("AUDIO_KEY_RE accepts valid key", AUDIO_KEY_RE.test("questions/123e4567-e89b-12d3-a456-426614174000/prompt.webm"));
  check("AUDIO_MIME_RE rejects video", !AUDIO_MIME_RE.test("video/webm"));
  check("AUDIO_MIME_RE rejects html", !AUDIO_MIME_RE.test("text/html"));

  await expectThrows(() => createQuestionAudioPresignedUpload("not-a-uuid", "audio/webm"), /Invalid questionId/, "presign invalid uuid");
  await expectThrows(() => createQuestionAudioPresignedUpload(admin.id, "video/webm"), /Invalid mimeType/, "presign video mime");
  await expectThrows(() => createQuestionAudioPresignedUpload(admin.id, "audio/webm"), /Question not found/, "presign for nonexistent question");

  const order = 100000 + Math.floor(Math.random() * 100000);
  const q = await createQuestion(admin.id, {
    category: QuestionCategory.PART_1,
    order,
    tasks: [],
  });

  try {
    await expectThrows(() => confirmQuestionAudioUpload(q.id), /Invalid audio storage key/, "confirm before presign (fresh row)");

    const { presignedUrl } = await createQuestionAudioPresignedUpload(q.id, "audio/webm");
    check("presigned url issued", presignedUrl.startsWith("https://"));

    await expectThrows(() => confirmQuestionAudioUpload(q.id), /Audio object not found/, "confirm before actual upload (HEAD 404)");
    await expectThrows(() => createQuestionAudioViewUrl(q.id), /Audio not yet uploaded/, "view url before upload");

    const res = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": "audio/webm", "Content-Length": "4" },
      body: randomBytes(4),
    });
    check("PUT to R2 succeeded", res.ok);

    await confirmQuestionAudioUpload(q.id);
    const afterConfirm = await prisma.question.findUnique({ where: { id: q.id }, select: { audioUploadStatus: true, audioStorageKey: true, audioSizeBytes: true } });
    check("row UPLOADED after confirm", afterConfirm?.audioUploadStatus === "UPLOADED");
    check("server-measured size recorded", afterConfirm?.audioSizeBytes === 4);
    check("storage key matches regex", !!afterConfirm?.audioStorageKey && AUDIO_KEY_RE.test(afterConfirm.audioStorageKey));

    await expectThrows(() => createQuestionAudioPresignedUpload(q.id, "audio/webm"), /Question audio already uploaded/, "re-presign after upload blocked");
    await expectThrows(() => confirmQuestionAudioUpload(q.id), /No pending audio upload/, "double confirm blocked");

    const url = await createQuestionAudioViewUrl(q.id);
    check("view url issued after upload", url.startsWith("https://"));
    const getRes = await fetch(url);
    check("GET audio from R2 returns 200", getRes.ok);

    await prisma.question.update({
      where: { id: q.id },
      data: { audioStorageKey: "submissions/evil/answers/x.webm" },
    });
    await expectThrows(() => createQuestionAudioViewUrl(q.id), /Invalid audio storage key/, "tampered storageKey rejected on view");

    await deleteQuestion(q.id);
    await expectThrows(() => confirmQuestionAudioUpload(q.id), /Question not found/, "confirm on soft-deleted question");
  } finally {
    await prisma.question.deleteMany({ where: { id: q.id } }).catch(() => {});
  }

  if (failures === 0) {
    console.log("\nAll question-audio security checks passed.");
  } else {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Script failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
