import { HeadObjectCommand, type HeadObjectCommandOutput, type S3Client } from "@aws-sdk/client-s3";

export interface FakeR2Object {
  contentLength: number;
  contentType: string;
  etag?: string;
  versionId?: string;
}

/**
 * Install a deterministic HeadObject seam for tests that exercise server-side
 * upload verification without contacting Cloudflare R2.
 */
export function installFakeR2Head(client: S3Client) {
  const objects = new Map<string, FakeR2Object>();
  const requests: string[] = [];
  const originalSend = client.send.bind(client);

  client.send = (async (command: unknown) => {
    if (!(command instanceof HeadObjectCommand)) {
      throw new Error(`Unexpected R2 command: ${command?.constructor?.name ?? "unknown"}`);
    }

    const key = command.input.Key;
    if (!key) throw new Error("R2 HeadObject key is required");
    requests.push(key);

    const object = objects.get(key);
    if (!object) {
      const notFound = new Error(`R2 object not found: ${key}`) as Error & {
        $metadata: { httpStatusCode: number };
      };
      notFound.$metadata = { httpStatusCode: 404 };
      throw notFound;
    }

    return {
      ContentLength: object.contentLength,
      ContentType: object.contentType,
      ETag: object.etag,
      VersionId: object.versionId,
    } satisfies HeadObjectCommandOutput;
  }) as typeof client.send;

  return {
    objects,
    requests,
    put(key: string, object: FakeR2Object) {
      objects.set(key, object);
    },
    clear() {
      objects.clear();
      requests.length = 0;
    },
    restore() {
      client.send = originalSend as typeof client.send;
    },
  };
}
