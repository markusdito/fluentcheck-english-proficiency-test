# Submission manifest cutover

This runbook is the release gate for issue #38. The cutover is deliberately
one-way for database writes: legacy rows remain readable, but once the
manifest-required migration is applied no new manifest-less `Submission` can
commit.

## Preflight

Run the read-only report against the production database and retain its JSON
output with the release record:

```sh
cd backend
npm run preflight:submission-manifest -- --json > /tmp/submission-manifest-preflight.json
test "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("/tmp/submission-manifest-preflight.json")).exitCode))')" = 0
```

Do not continue when the report contains duplicate active legacy submissions,
broken references, identity violations, or invalid version-1 manifests. The
report is read-only; operators must reconcile the named conflicts and rerun it.

## Deployment order

1. Deploy the additive schema and dual-read application code. Verify that a
   representative completed legacy submission still renders through the
   legacy reader and that a newly initialized submission has a complete
   version-1 manifest.
2. Apply the prior manifest-enforcement migration
   `20260829130000_enforce_manifest_on_new_submissions` before starting the
   assignment cutover. Its deferred database trigger lets the application
   insert the Submission, manifest, entries, and tasks in one transaction
   while the database rejects an incomplete commit. If later migrations are
   pending, apply only this named migration in the release stage; do not run a
   blanket `prisma migrate deploy` that would skip the assignment preflight
   gate. For a manually staged migration, run its SQL with
   the following commands, then record it in Prisma's migration history:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f "prisma/migrations/<migration-name>/migration.sql"
   npx prisma migrate resolve --schema prisma/schema.prisma \
     --applied "<migration-name>"
   ```
3. Drain old Submission writer instances. Confirm that no instance capable of
   split `Submission` creation or student Question delivery remains in
   service, then run the manifest preflight again from a repeatable-read
   snapshot.
4. Apply the expansion migration
   `20260829140000_expand_examiner_assignment_slots`. Deploy the assignment
   writers that populate both fixed slots, drain every older writer capable of
   omitting a slot, and rerun the read-only examiner-assignment preflight
   immediately before enforcement. Do not continue while it reports any
   irregularity.
5. Apply only
   `20260829150000_enforce_required_examiner_assignment_slots` after the
   assignment preflight passes. This final migration makes slots mandatory
   and replaces the expansion-stage partial uniqueness guard with the required
   two-slot constraint. Use the same staged SQL-plus-`migrate resolve` method
   when other migrations are pending so the preflight remains immediately
   before this enforcement step.
6. Run the authenticated HTTP smoke suite and retain its output. It must cover
   successful, unavailable, retry, replay, resume, abandonment, conflict,
   upload proof, completion, downstream reads, and prompt authorization paths.

## Rollback

If the smoke suite fails, stop accepting new assessment starts and route the
start endpoint to a maintenance response. Roll back application binaries only
after starts are disabled. Never roll back to a writer that can create a
manifest-less submission: the database trigger is intentionally not removed
as part of an application rollback. Existing submissions remain readable via
their manifest or explicit Legacy path.

## Verification boundary

The repository tests deterministically verify selection, signing seams,
transactionality, database constraints, upload proofs, and authorization.
They do not prove that a live R2 object is readable by a browser or that a
production browser can play every prompt. Those properties require a separate
authorized storage and browser smoke test; the release record must state
whether those checks were run rather than inferring them from unit tests.
