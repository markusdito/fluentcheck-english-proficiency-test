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
2. Drain old writer instances. Confirm that no instance capable of split
   `Submission` creation or student Question delivery remains in service.
3. Run the preflight again from a repeatable-read snapshot.
4. Apply the expansion migration
   `20260829140000_expand_examiner_assignment_slots`. Confirm that every
   assignment writer now populates both fixed slots, drain every older writer
   capable of omitting a slot, and rerun the read-only examiner-assignment
   preflight immediately before enforcement. Do not continue while it reports
   any irregularity.
5. Apply Prisma migrations, including
   `20260829130000_enforce_manifest_on_new_submissions` and
   `20260829150000_enforce_required_examiner_assignment_slots`. The manifest
   migration adds a deferred database trigger, so the application may insert
   the Submission, manifest, entries, and tasks in one transaction while the
   database rejects an incomplete commit. The final assignment migration
   makes slots mandatory and replaces the expansion-stage partial uniqueness
   guard with the required two-slot constraint.
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
