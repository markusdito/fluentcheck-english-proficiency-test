function valuesHaveConflicts(values) {
    return Object.values(values).some((value) => value > 0);
}
const SQL = {
    // One row per Submission that has assignments, with every conflict the
    // expansion and enforcement stages reject. Read-only: never repairs data.
    assignmentGroups: [
        'SELECT a."submissionId" AS "submissionId",',
        '       s."status"::text AS "submissionStatus",',
        '       COUNT(*)::int AS "assignmentCount",',
        '       COUNT(*) FILTER (WHERE a."slot" IS NULL)::int AS "unpopulatedSlots",',
        "       COUNT(*) FILTER (WHERE a.\"slot\" IS NOT NULL AND a.\"slot\" NOT IN (1, 2))::int",
        '         AS "invalidSlots",',
        '       (SELECT COUNT(*)::int FROM (',
        '            SELECT a2."slot" FROM "ExaminerAssignment" a2',
        '             WHERE a2."submissionId" = a."submissionId" AND a2."slot" IS NOT NULL',
        '             GROUP BY a2."slot" HAVING COUNT(*) > 1',
        '        ) dup) AS "duplicateSlots",',
        '       (SELECT COUNT(*)::int FROM (',
        '            SELECT a3."examinerId" FROM "ExaminerAssignment" a3',
        '             WHERE a3."submissionId" = a."submissionId"',
        '             GROUP BY a3."examinerId" HAVING COUNT(*) > 1',
        '        ) dupx) AS "duplicateExaminers",',
        "       CASE WHEN s.\"status\" NOT IN ('SCORING', 'SCORED', 'CERTIFIED')",
        '            THEN 1 ELSE 0 END AS "lifecycleInconsistent"',
        '  FROM "ExaminerAssignment" a',
        '  JOIN "Submission" s ON s."id" = a."submissionId"',
        ' GROUP BY a."submissionId", s."status"',
        ' ORDER BY MIN(a."createdAt"), a."submissionId"',
    ].join("\n"),
};
/**
 * Inspect assignment-cardinality readiness from one repeatable, read-only
 * database snapshot. The report identifies conflicts but never creates,
 * deletes, reassigns, or repairs Examiner assignments or Scores.
 */
export async function inspectExaminerAssignmentReadiness(client, dependencies = {}) {
    const now = dependencies.now ?? (() => new Date());
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        const assignmentGroups = (await client.query(SQL.assignmentGroups)).rows;
        await client.query("COMMIT");
        const conflicts = {
            oneAssignmentSubmissions: assignmentGroups.filter((group) => group.assignmentCount === 1).length,
            excessAssignmentSubmissions: assignmentGroups.filter((group) => group.assignmentCount > 2).length,
            unpopulatedSlotAssignments: assignmentGroups.reduce((sum, group) => sum + group.unpopulatedSlots, 0),
            invalidSlotAssignments: assignmentGroups.reduce((sum, group) => sum + group.invalidSlots, 0),
            duplicateSlotSubmissions: assignmentGroups.filter((group) => group.duplicateSlots > 0).length,
            duplicateExaminerSubmissions: assignmentGroups.filter((group) => group.duplicateExaminers > 0).length,
            lifecycleInconsistentSubmissions: assignmentGroups.filter((group) => group.lifecycleInconsistent > 0).length,
        };
        return {
            generatedAt: now().toISOString(),
            assignmentGroups,
            conflicts,
            exitCode: valuesHaveConflicts(conflicts) ? 1 : 0,
        };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
