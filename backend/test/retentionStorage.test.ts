import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

test("storage cleanup requires a follow-up absence check before claiming deletion", async () => {
  process.env.R2_ACCOUNT_ID ??= "retention-storage-test-account";
  process.env.R2_ACCESS_KEY_ID ??= "retention-storage-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY ??= "retention-storage-test-secret";
  process.env.R2_BUCKET_NAME ??= "retention-storage-test-bucket";
  const [{ deleteStorageObject }, { r2Client }] = await Promise.all([
    import("../src/service/retentionStorage.service.js"),
    import("../src/config/r2.js"),
  ]);
  const originalSend = r2Client.send;
  let present = true;
  let deleteRemovesObject = false;
  let headCalls = 0;
  let deleteCalls = 0;

  r2Client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      headCalls += 1;
      if (!present) {
        const error = new Error("not found") as Error & {
          $metadata: { httpStatusCode: number };
        };
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return { $metadata: {} };
    }
    if (command instanceof DeleteObjectCommand) {
      deleteCalls += 1;
      if (deleteRemovesObject) present = false;
      return { $metadata: {} };
    }
    throw new Error(`Unexpected R2 command: ${command?.constructor?.name ?? "unknown"}`);
  }) as typeof r2Client.send;

  try {
    await assert.rejects(
      deleteStorageObject("questions/question-1/prompt.webm", "retention-storage-test-bucket"),
      /Storage deletion was not confirmed/u,
    );
    assert.equal(headCalls, 2);
    assert.equal(deleteCalls, 1);

    deleteRemovesObject = true;
    const confirmation = await deleteStorageObject(
      "questions/question-1/prompt.webm",
      "retention-storage-test-bucket",
    );
    assert.deepEqual(confirmation, { outcome: "DELETED" });
    assert.equal(headCalls, 4);
    assert.equal(deleteCalls, 2);
  } finally {
    r2Client.send = originalSend;
  }
});
