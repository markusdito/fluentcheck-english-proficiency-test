const SQL = {
    accounts: [
        'SELECT COUNT(*)::int AS "total",',
        '       COUNT(*) FILTER (WHERE "deletedAt" IS NULL)::int AS "active",',
        '       COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS "deactivated",',
        '       COUNT(*) FILTER (WHERE "normalizedEmail" IS NULL)::int AS "legacyRows"',
        '  FROM "User"',
    ].join("\n"),
    normalizedEmailConflicts: [
        'SELECT ARRAY_AGG("id"::text ORDER BY "id"::text) AS "userIds",',
        '       COUNT(*) FILTER (WHERE "deletedAt" IS NULL)::int AS "activeUsers",',
        '       COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS "deactivatedUsers"',
        '  FROM "User"',
        ' GROUP BY LOWER(BTRIM("email"))',
        'HAVING COUNT(*) > 1',
        ' ORDER BY MIN("id"::text)',
    ].join("\n"),
    canonicalUsernameConflicts: [
        'SELECT ARRAY_AGG("id"::text ORDER BY "id"::text) AS "userIds",',
        '       COUNT(*) FILTER (WHERE "deletedAt" IS NULL)::int AS "activeUsers",',
        '       COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS "deactivatedUsers"',
        '  FROM "User"',
        ' GROUP BY LOWER(BTRIM("username"))',
        'HAVING COUNT(*) > 1',
        ' ORDER BY MIN("id"::text)',
    ].join("\n"),
    invalidLegacyUsernames: [
        'SELECT "id"::text AS "userId", "deletedAt" IS NULL AS "active"',
        '  FROM "User"',
        " WHERE CHAR_LENGTH(LOWER(BTRIM(\"username\"))) NOT BETWEEN 1 AND 50",
        "    OR LOWER(BTRIM(\"username\")) !~ '^[a-z0-9_]+$'",
        ' ORDER BY "id"::text',
    ].join("\n"),
    normalizedEmailMismatches: [
        'SELECT "id"::text AS "userId", "deletedAt" IS NULL AS "active"',
        '  FROM "User"',
        ' WHERE "normalizedEmail" IS NOT NULL',
        '   AND "normalizedEmail" <> LOWER(BTRIM("email"))',
        ' ORDER BY "id"::text',
    ].join("\n"),
};
function hasConflicts(result) {
    return (result.normalizedEmailConflicts.length > 0 ||
        result.canonicalUsernameConflicts.length > 0 ||
        result.invalidLegacyUsernames.length > 0 ||
        result.normalizedEmailMismatches.length > 0);
}
/**
 * Inspect the account-identity rollout from one repeatable, read-only snapshot.
 * This report never backfills, merges, reassigns, or otherwise repairs accounts.
 */
export async function inspectAccountIdentityReadiness(client, dependencies = {}) {
    const now = dependencies.now ?? (() => new Date());
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        const accounts = (await client.query(SQL.accounts)).rows[0];
        const normalizedEmailConflicts = (await client.query(SQL.normalizedEmailConflicts)).rows;
        const canonicalUsernameConflicts = (await client.query(SQL.canonicalUsernameConflicts)).rows;
        const invalidLegacyUsernames = (await client.query(SQL.invalidLegacyUsernames)).rows;
        const normalizedEmailMismatches = (await client.query(SQL.normalizedEmailMismatches)).rows;
        await client.query("COMMIT");
        const result = {
            accounts,
            normalizedEmailConflicts,
            canonicalUsernameConflicts,
            invalidLegacyUsernames,
            normalizedEmailMismatches,
        };
        return {
            generatedAt: now().toISOString(),
            ...result,
            exitCode: hasConflicts(result) ? 1 : 0,
        };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
