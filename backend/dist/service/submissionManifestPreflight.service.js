function valuesHaveConflicts(values) {
    return Object.values(values).some((value) => value > 0);
}
const SQL = {
    lifecycle: [
        'SELECT s."status"::text AS "status",',
        '       COUNT(DISTINCT s."id")::int AS "submissionCount",',
        '       COUNT(a."id")::int AS "answerCount"',
        '  FROM "Submission" s',
        '  LEFT JOIN "SubmissionManifest" sm ON sm."submissionId" = s."id"',
        '  LEFT JOIN "Answer" a ON a."submissionId" = s."id"',
        ' WHERE sm."id" IS NULL',
        ' GROUP BY s."status"',
        ' ORDER BY CASE s."status"',
        "   WHEN 'IN_PROGRESS' THEN 1",
        "   WHEN 'AWAITING_PAYMENT' THEN 2",
        "   WHEN 'PAID' THEN 3",
        "   WHEN 'SCORING' THEN 4",
        "   WHEN 'SCORED' THEN 5",
        "   WHEN 'CERTIFIED' THEN 6",
        ' END',
    ].join("\n"),
    duplicateActiveLegacySubmissions: [
        'SELECT ARRAY_AGG(s."id" ORDER BY s."createdAt", s."id") AS "submissionIds"',
        '  FROM "Submission" s',
        '  LEFT JOIN "SubmissionManifest" sm ON sm."submissionId" = s."id"',
        ' WHERE sm."id" IS NULL AND s."status" = \'IN_PROGRESS\'',
        ' GROUP BY s."studentId"',
        'HAVING COUNT(*) > 1',
        ' ORDER BY MIN(s."createdAt"), MIN(s."id"::text)',
    ].join("\n"),
    brokenReferences: [
        'SELECT',
        '  (SELECT COUNT(*)::int FROM "Submission" s',
        '    LEFT JOIN "User" u ON u."id" = s."studentId"',
        '   WHERE u."id" IS NULL) AS "submissionsWithoutStudents",',
        '  (SELECT COUNT(*)::int FROM "Answer" a',
        '    LEFT JOIN "Submission" s ON s."id" = a."submissionId"',
        '   WHERE s."id" IS NULL) AS "answersWithoutSubmissions",',
        '  (SELECT COUNT(*)::int FROM "Answer" a',
        '    LEFT JOIN "Question" q ON q."id" = a."questionId"',
        '   WHERE a."questionId" IS NOT NULL AND q."id" IS NULL)',
        '    AS "legacyAnswersWithoutQuestions",',
        '  (SELECT COUNT(*)::int FROM "ManifestEntry" me',
        '    LEFT JOIN "SubmissionManifest" sm',
        '      ON sm."id" = me."manifestId" AND sm."submissionId" = me."submissionId"',
        '   WHERE sm."id" IS NULL) AS "manifestEntriesWithoutManifests",',
        '  (SELECT COUNT(*)::int FROM "ManifestEntry" me',
        '    LEFT JOIN "Question" q ON q."id" = me."sourceQuestionId"',
        '   WHERE q."id" IS NULL) AS "manifestEntriesWithoutQuestions",',
        '  (SELECT COUNT(*)::int FROM "ManifestTask" mt',
        '    LEFT JOIN "ManifestEntry" me',
        '      ON me."id" = mt."manifestEntryId"',
        '     AND me."sourceQuestionId" = mt."sourceQuestionId"',
        '   WHERE me."id" IS NULL) AS "manifestTasksWithoutEntries",',
        '  (SELECT COUNT(*)::int FROM "ManifestTask" mt',
        '    LEFT JOIN "Task" t',
        '      ON t."id" = mt."sourceTaskId"',
        '     AND t."questionId" = mt."sourceQuestionId"',
        '   WHERE t."id" IS NULL) AS "manifestTasksWithoutSourceTasks",',
        '  (SELECT COUNT(*)::int FROM "Answer" a',
        '    LEFT JOIN "ManifestEntry" me',
        '      ON me."id" = a."manifestEntryId"',
        '     AND me."submissionId" = a."submissionId"',
        '   WHERE a."manifestEntryId" IS NOT NULL AND me."id" IS NULL)',
        '    AS "manifestAnswersWithoutEntries"',
    ].join("\n"),
    laterEnforcementViolations: [
        'SELECT',
        '  (SELECT COUNT(*)::int FROM "Answer"',
        '   WHERE "questionId" IS NULL AND "manifestEntryId" IS NULL)',
        '    AS "answersWithNoIdentity",',
        '  (SELECT COUNT(*)::int FROM "Answer"',
        '   WHERE "questionId" IS NOT NULL AND "manifestEntryId" IS NOT NULL)',
        '    AS "answersWithCompetingIdentities",',
        '  (SELECT COUNT(*)::int FROM "Answer" a',
        '    JOIN "ManifestEntry" me ON me."id" = a."manifestEntryId"',
        '   WHERE a."submissionId" <> me."submissionId")',
        '    AS "manifestAnswersWithSubmissionMismatch",',
        '  (SELECT COUNT(*)::int',
        '     FROM "SubmissionManifest" sm',
        '    WHERE sm."version" = 1',
        '      AND NOT submission_manifest_v1_has_exact_shape(sm."id"))',
        '    AS "invalidVersion1Manifests"',
    ].join("\n"),
};
/**
 * Inspect rollout readiness from one repeatable, read-only database snapshot.
 * The report identifies conflicts but never selects, backfills, or repairs data.
 */
export async function inspectSubmissionManifestReadiness(client, dependencies = {}) {
    const now = dependencies.now ?? (() => new Date());
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        const lifecycle = (await client.query(SQL.lifecycle)).rows;
        const duplicateActiveLegacySubmissions = (await client.query(SQL.duplicateActiveLegacySubmissions)).rows;
        const brokenReferences = (await client.query(SQL.brokenReferences)).rows[0];
        const laterEnforcementViolations = (await client.query(SQL.laterEnforcementViolations)).rows[0];
        await client.query("COMMIT");
        const legacy = lifecycle.reduce((summary, row) => ({
            submissionCount: summary.submissionCount + row.submissionCount,
            answerCount: summary.answerCount + row.answerCount,
            lifecycle: summary.lifecycle,
        }), { submissionCount: 0, answerCount: 0, lifecycle });
        const hasConflicts = duplicateActiveLegacySubmissions.length > 0 ||
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
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
