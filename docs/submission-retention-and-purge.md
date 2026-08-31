# Submission retention and Prompt-media cleanup runbook

This runbook implements the accepted policy in ADR-0015. It is intentionally conservative: ordinary application traffic cannot purge a Submission, and cleanup is disabled unless the operator supplies the feature gate and authorization evidence.

## Policy

- Every Submission is `RETAINED` by default. There is no automatic age-based purge.
- Only `IN_PROGRESS`, `ABANDONED`, and `AWAITING_PAYMENT` Submissions with no active Retention hold and no payment, assignment, or certificate obligation may enter purge quarantine.
- `PAID`, `SCORING`, `SCORED`, and `CERTIFIED` Submissions are blocked in v1. A future policy revision must define their legal/business retention before code may loosen this gate.
- A purge request records the target identity, requester, reason, policy version, and timestamp. A different active `ADMIN` must approve it.
- Approval moves the Submission to quarantine for 30 days and blocks student, examiner, and administrator evidence access. Recovery is a cancellation before finalization; cancellation never rewrites or fabricates evidence.
- Finalization deletes only the exact Answer-media identities captured in the purge request. It then removes Answer rows, manifest tasks/entries, the manifest, the start intent, and the purgeable Submission. The immutable Retention audit remains.
- Prompt media is never deleted by Submission purge. Its separate cleanup workflow protects both retained Answer references and retained Manifest-entry snapshot references.

## Dry-run inventory

Run the read-only inventory first:

```bash
npm run cleanup:prompt-media -- --json
```

The output is machine-readable and contains one record per Prompt-media identity derived from Retired questions and their Delivered prompt snapshots. Each record includes the exact storage key, source Question IDs, retained Answer and Manifest-entry references, storage existence state, eligibility, and the reason it is eligible or blocked. The default mode performs no database or storage mutation.

The inventory is not a bucket scan. Invalid or missing identities, storage failures, retained references, active source Questions, and already absent objects are reported as non-eligible outcomes.

## Purge request and approval

The service boundary requires an active administrator, a non-empty reason, and a distinct approving active administrator. The request and approval create immutable Retention audit events. An active hold or an ineligible Submission state fails closed; it never creates a partial purge.

The approved request captures Answer-media identities before quarantine. A request may be cancelled while all captured objects remain quarantined and no final deletion attempt has started. Once finalization begins, cancellation is rejected.

## Authorized Prompt-media cleanup

The feature gate is off by default:

```bash
RETENTION_CLEANUP_ENABLED=1 npm run cleanup:prompt-media -- \
  --execute \
  --actor-id <active-admin-id> \
  --authorization-id <change-or-approval-id> \
  --reason "Approved retired Prompt-media cleanup"
```

`--execute` creates a durable cleanup run and places eligible identities into a 30-day Cleanup quarantine. It does not delete storage objects. The exact identity remains recoverable during quarantine; a new retained reference causes finalization to skip that identity.

After the quarantine boundary, finalize with a fresh explicit authorization:

```bash
RETENTION_CLEANUP_ENABLED=1 npm run cleanup:prompt-media -- \
  --finalize \
  --actor-id <active-admin-id> \
  --authorization-id <change-or-approval-id> \
  --reason "Approved finalization after quarantine"
```

Finalization acquires the per-identity PostgreSQL advisory lock, rechecks Retired source state and retained Answer/Manifest-entry references, and keeps that lock through the storage delete and follow-up existence check. A new reference therefore either commits before the check and blocks deletion, or waits until after a confirmed deletion. The operation never reports `DELETED` from the delete request alone.

## Failure, retry, and recovery

- A storage error creates a visible failed attempt with the exact key, actor, reason, attempt count, and error outcome. The identity stays retryable.
- A follow-up existence check that still finds the object is a failed deletion, not success.
- An already absent object is recorded as `ALREADY_ABSENT`; no false successful deletion claim is made.
- A quarantined Submission can be recovered only before finalization. After storage confirms deletion, the evidence is irreversible and the audit must not claim recovery.
- Missing historical Prompt media is reported for incident/recovery handling. FluentCheck never fabricates replacement assessment evidence.

## Audit and operator evidence

Retain the JSON output and the immutable Retention audit events with the change/approval record. The audit includes target identity, actor, authorization ID, policy version, reason, action, storage identity where applicable, timestamps, and the confirmed outcome. Audit rows cannot be updated or deleted through the database trigger.
