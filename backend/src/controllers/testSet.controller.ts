import type { Request, Response } from "express";
import {
  createTestSet as createTestSetService,
  InvalidTestSetCodeError,
  listTestSets,
  renameTestSet as renameTestSetService,
  TestSetCodeConflictError,
} from "../service/testSet.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function handleTestSetError(res: Response, error: unknown) {
  if (error instanceof InvalidTestSetCodeError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof TestSetCodeConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message === "Test Set not found") {
    res.status(404).json({ error: error.message });
    return;
  }
  console.error("Test Set operation failed:", error);
  res.status(500).json({ error: "Internal server error" });
}

/** GET /api/admin/test-sets — every Test Set with per-slot readiness. */
export async function getTestSets(_req: Request, res: Response) {
  try {
    res.status(200).json({ status: "success", data: await listTestSets() });
  } catch (error) {
    handleTestSetError(res, error);
  }
}

/** POST /api/admin/test-sets — create an empty (Draft) Test Set. */
export async function createTestSet(req: Request, res: Response) {
  try {
    const testSet = await createTestSetService(req.body?.code);
    res.status(201).json({ status: "success", data: testSet });
  } catch (error) {
    handleTestSetError(res, error);
  }
}

/** PUT /api/admin/test-sets/:id — rename a Test Set's code. */
export async function renameTestSet(req: Request, res: Response) {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Test Set not found" });
    return;
  }
  try {
    const testSet = await renameTestSetService(id, req.body?.code);
    res.status(200).json({ status: "success", data: testSet });
  } catch (error) {
    handleTestSetError(res, error);
  }
}
