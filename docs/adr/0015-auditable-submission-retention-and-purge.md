# Auditable Submission retention and Prompt-media cleanup

Status: accepted

FluentCheck retains every Submission until an explicit, dual-control purge; it does not run an automatic age-based purge. Incomplete, abandoned, and awaiting-payment Submissions without active Retention holds may be purged, while paid, scoring, scored, and certified Submissions remain blocked by their payment, assignment, scoring, dispute, recovery, or certificate obligations.

An approved purge first moves the Submission into a recoverable 30-day quarantine and records the exact Answer-media identities. Finalization is allowed only after quarantine, explicit operator authorization, and the cleanup feature gate are present. Storage deletion is performed per identity while its PostgreSQL advisory lock is held and is successful only after a follow-up existence check; failed attempts remain retryable. An already-absent object is recorded distinctly as `MISSING`, which is a confirmed absence but not a claim that this run deleted it. The Submission's Answer media, manifest evidence, and start intent are removed only after all Answer-media deletions are confirmed, while the immutable retention audit preserves the target identity, actors, policy version, reason, and outcomes.

Prompt-media cleanup is a separate dry-run-first operation. It may consider only Prompt media belonging to Retired questions, and it must protect every reference from a non-purged Submission, including a Manifest entry that has no Answer yet. Active Questions sharing a retired identity block the candidate. A per-storage-identity PostgreSQL advisory lock serializes retirement, manifest/Answer reference creation, purge reference removal, and cleanup's final reference check plus storage deletion. No bucket-wide orphan sweep is authorized.

## Considered options

- Automatic time-based deletion: rejected until a legal/business retention period is supplied and approved.
- Deleting immediately after approval: rejected because it removes the recovery boundary and makes operator mistakes irreversible.
- Answer-only reference checks: rejected because Delivered prompt snapshots can reference Prompt media before an Answer exists.
- Bucket-wide object discovery: rejected because storage inventory cannot prove the domain identity or authorization of an object.

## Consequences

- Purge and cleanup require a durable immutable audit trail and explicit actor/authorization evidence.
- Recovery is available only before the 30-day quarantine ends and before storage confirms irreversible deletion.
- The cleanup worker remains disabled unless `RETENTION_CLEANUP_ENABLED=1` is explicitly configured.
- Existing Question retirement remains evidence-preserving; it never becomes an implicit purge operation.
- Answer-media identity reuse is rejected while a purge reservation is active or after storage absence is confirmed; pre-existing shared identities fail closed at approval and finalization.
- Quarantine blocks all new evidence URL issuance. R2 signed URLs are not individually revocable, so the maximum in-flight URL lifetime is five minutes.
