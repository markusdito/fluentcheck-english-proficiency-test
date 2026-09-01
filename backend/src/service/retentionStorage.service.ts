import {
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { r2Client } from "../config/r2.js";

export interface StorageDeleteConfirmation {
  outcome: "DELETED" | "ALREADY_ABSENT";
}

function isNotFound(error: unknown): boolean {
  return (
    (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode === 404
  );
}

async function objectExists(storageKey: string, bucket: string): Promise<boolean> {
  try {
    await r2Client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Delete one exact storage identity and prove absence with a follow-up HEAD.
 * A successful DeleteObject response alone is never treated as completion.
 */
export async function deleteStorageObject(
  storageKey: string,
  bucket = env.R2_BUCKET_NAME,
): Promise<StorageDeleteConfirmation> {
  const existedBefore = await objectExists(storageKey, bucket);
  await r2Client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
  );
  if (await objectExists(storageKey, bucket)) {
    throw new Error("Storage deletion was not confirmed: object still exists");
  }
  return { outcome: existedBefore ? "DELETED" : "ALREADY_ABSENT" };
}
