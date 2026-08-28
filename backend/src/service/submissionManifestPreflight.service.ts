import type { Client, QueryResultRow } from "pg";

interface SubmissionManifestPreflightDependencies {
  now?: () => Date;
}

interface LifecycleRow extends QueryResultRow {
  status: string;
  submissionCount: number;
  answerCount: number;
}

interface DuplicateActiveRow extends QueryResultRow {
  submissionIds: string[];
}

export interface SubmissionManifestPreflightResult {
  generatedAt: string;
  legacy: {
    submissionCount: number;
    answerCount: number;
    lifecycle: LifecycleRow[];
  };
  duplicateActiveLegacySubmissions: DuplicateActiveRow[];
  brokenReferences: {
    submissionsWithoutStudents: number;
    answersWithoutSubmissions: number;
    legacyAnswersWithoutQuestions: number;
    manifestEntriesWithoutManifests: number;
    manifestEntriesWithoutQuestions: number;
    manifestTasksWithoutEntries: number;
    manifestTasksWithoutSourceTasks: number;
    manifestAnswersWithoutEntries: number;
  };
  laterEnforcementViolations: {
    activeLegacySubmissions: number;
    answersWithNoIdentity: number;
    answersWithCompetingIdentities: number;
    manifestAnswersWithSubmissionMismatch: number;
    invalidVersion1Manifests: number;
  };
  exitCode: 0 | 1;
}

function valuesHaveConflicts(values: Record<string, number>) {
  return Object.values(values).some((value) => value > 0);
}

/**
 * Inspect rollout readiness from one repeatable, read-only database snapshot.
 * The report identifies conflicts but never selects, backfills, or repairs data.
 */
export async function inspectSubmissionManifestReadiness(
  client: Client,
  dependencies: SubmissionManifestPreflightDependencies = {},
): Promise<SubmissionManifestPreflightResult> {
  const now = dependencies.now ?? (() => new Date());
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );

  try {
    const lifecycle = (
      await client.query<LifecycleRow>(
        `SELECT s."status"::text AS "status",
                COUNT(DISTINCT s."id")::int AS "submissionCount",
                COUNT(a."id")::int AS "answerCount"
           FROM "Submission" s
           LEFT JOIN "SubmissionManifest" sm ON sm."submissionId" = s."id"
           LEFT JOIN "Answer" a ON a."submissionId" = s."id"
          WHERE sm."id" IS NULL
          GROUP BY s."status"
          ORDER BY CASE s."status"
            WHEN 'IN_PROGRESS' THEN 1
            WHEN 'AWAITING_PAYMENT' THEN 2
            WHEN 'PAID' THEN 3
            WHEN 'SCORING' THEN 4
            WHEN 'SCORED' THEN 5
            WHEN 'CERTIFIED' THEN 6
          END`,
      )
    ).rows;

    const duplicateActiveLegacySubmissions = (
      await client.query<DuplicateActiveRow>(
        `SELECT ARRAY_AGG(s."id" ORDER BY s."createdAt", s."id") AS "submissionIds"
           FROM "Submission" s
           LEFT JOIN "SubmissionManifest" sm ON sm."submissionId" = s."id"
          WHERE sm."id" IS NULL AND s."status" = 'IN_PROGRESS'
          GROUP BY s."studentId"
         HAVING COUNT(*) > 1
          ORDER BY MIN(s."createdAt"), MIN(s."id"::text)`,
      )
    ).rows;

    const brokenReferences = (
      await client.query<
        QueryResultRow & SubmissionManifestPreflightResult["brokenReferences"]
      >(
        `SELECT
          (SELECT COUNT(*)::int FROM "Submission" s
            LEFT JOIN "User" u ON u."id" = s."studentId"
           WHERE u."id" IS NULL) AS "submissionsWithoutStudents",
          (SELECT COUNT(*)::int FROM "Answer" a
            LEFT JOIN "Submission" s ON s."id" = a."submissionId"
           WHERE s."id" IS NULL) AS "answersWithoutSubmissions",
          (SELECT COUNT(*)::int FROM "Answer" a
            LEFT JOIN "Question" q ON q."id" = a."questionId"
           WHERE a."questionId" IS NOT NULL AND q."id" IS NULL)
            AS "legacyAnswersWithoutQuestions",
          (SELECT COUNT(*)::int FROM "ManifestEntry" me
            LEFT JOIN "SubmissionManifest" sm
              ON sm."id" = me."manifestId" AND sm."submissionId" = me."submissionId"
           WHERE sm."id" IS NULL) AS "manifestEntriesWithoutManifests",
          (SELECT COUNT(*)::int FROM "ManifestEntry" me
            LEFT JOIN "Question" q ON q."id" = me."sourceQuestionId"
           WHERE q."id" IS NULL) AS "manifestEntriesWithoutQuestions",
          (SELECT COUNT(*)::int FROM "ManifestTask" mt
            LEFT JOIN "ManifestEntry" me ON me."id" = mt."manifestEntryId"
           WHERE me."id" IS NULL) AS "manifestTasksWithoutEntries",
          (SELECT COUNT(*)::int FROM "ManifestTask" mt
            LEFT JOIN "Task" t
              ON t."id" = mt."sourceTaskId"
             AND t."questionId" = mt."sourceQuestionId"
           WHERE t."id" IS NULL) AS "manifestTasksWithoutSourceTasks",
          (SELECT COUNT(*)::int FROM "Answer" a
            LEFT JOIN "ManifestEntry" me
              ON me."id" = a."manifestEntryId"
             AND me."submissionId" = a."submissionId"
           WHERE a."manifestEntryId" IS NOT NULL AND me."id" IS NULL)
            AS "manifestAnswersWithoutEntries"`,
      )
    ).rows[0];

    const laterEnforcementViolations = (
      await client.query<
        QueryResultRow &
          SubmissionManifestPreflightResult["laterEnforcementViolations"]
      >(
        `SELECT
          (SELECT COUNT(*)::int FROM "Submission" s
            LEFT JOIN "SubmissionManifest" sm ON sm."submissionId" = s."id"
           WHERE sm."id" IS NULL AND s."status" = 'IN_PROGRESS')
            AS "activeLegacySubmissions",
          (SELECT COUNT(*)::int FROM "Answer"
           WHERE "questionId" IS NULL AND "manifestEntryId" IS NULL)
            AS "answersWithNoIdentity",
          (SELECT COUNT(*)::int FROM "Answer"
           WHERE "questionId" IS NOT NULL AND "manifestEntryId" IS NOT NULL)
            AS "answersWithCompetingIdentities",
          (SELECT COUNT(*)::int FROM "Answer" a
            JOIN "ManifestEntry" me ON me."id" = a."manifestEntryId"
           WHERE a."submissionId" <> me."submissionId")
            AS "manifestAnswersWithSubmissionMismatch",
          (SELECT COUNT(*)::int
             FROM "SubmissionManifest" sm
             LEFT JOIN LATERAL (
               SELECT COUNT(*) AS entry_count,
                      COUNT(*) FILTER (WHERE me."category" = 'PART_1') AS part_1_count,
                      COUNT(*) FILTER (WHERE me."category" = 'PART_2') AS part_2_count,
                      COUNT(*) FILTER (WHERE me."category" = 'PART_3') AS part_3_count,
                      COUNT(*) FILTER (WHERE me."deliveryPosition" = 1) AS position_1_count,
                      COUNT(*) FILTER (WHERE me."deliveryPosition" = 2) AS position_2_count,
                      COUNT(*) FILTER (WHERE me."deliveryPosition" = 3) AS position_3_count
                 FROM "ManifestEntry" me
                WHERE me."manifestId" = sm."id"
             ) shape ON TRUE
            WHERE sm."version" = 1
              AND NOT (
                shape.entry_count = 3
                AND shape.part_1_count = 1
                AND shape.part_2_count = 1
                AND shape.part_3_count = 1
                AND shape.position_1_count = 1
                AND shape.position_2_count = 1
                AND shape.position_3_count = 1
              )) AS "invalidVersion1Manifests"`,
      )
    ).rows[0];

    await client.query("COMMIT");

    const legacy = lifecycle.reduce(
      (summary, row) => ({
        submissionCount: summary.submissionCount + row.submissionCount,
        answerCount: summary.answerCount + row.answerCount,
        lifecycle: summary.lifecycle,
      }),
      { submissionCount: 0, answerCount: 0, lifecycle },
    );
    const hasConflicts =
      duplicateActiveLegacySubmissions.length > 0 ||
      valuesHaveConflicts(brokenReferences) ||
      valuesHaveConflicts(laterEnforcementViolations);

    return {
      generatedAt: now().toISOString(),
      legacy,
      duplicateActiveLegacySubmissions,
      brokenReferences,
      laterEnforcementViolations,
      exitCode: hasConflicts ? 1 : 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
