# Runbook: assessment initialization failures

This runbook covers the `PromptMediaPreparationFailed` (warning) and
`PromptMediaPreparationFailureBurst` (page) alerts raised on Grafana-managed
rules against the `fluentcheck-backend` Loki stream in production. It applies
to manifest-backed Submission initialization only. The dashboard is
**Assessment initialization** (`/d/assessment-initialization`).

## What fired, and what it means

Authenticated assessment initialization selects one Question per Required
category, prepares every runtime Prompt-media URL, revalidates the selection,
and persists the complete Submission atomically. Any preparation failure rolls
everything back, emits one sanitized `submission_initialization_failed` event,
and returns the stable `503 ASSESSMENT_UNAVAILABLE` body with `Retry-After: 5`
to the student.

| Signal | Meaning |
| --- | --- |
| `PromptMediaPreparationFailed` (warning) | At least one production initialization failed during Prompt media preparation. |
| `PromptMediaPreparationFailureBurst` (page) | Three or more preparation failures within five minutes: Prompt media preparation is systematically failing, not failing for one student. |

Both alerts identify the affected service (`fluentcheck-backend`) and
environment (`production`) in their labels and summary. The dashboard shows
attempts, failures, the failure rate, and the failure reason breakdown.

## Configuration checks (do these first)

1. Confirm the backend booted with a complete observability configuration. In
   production, startup fails fast unless all of the following are set:
   - `OBSERVABILITY_LOKI_URL` — Grafana Cloud Loki base URL (HTTPS, no
     credentials, query, or fragment).
   - `OBSERVABILITY_LOKI_USERNAME` and `OBSERVABILITY_LOKI_TOKEN` — set
     together; the token is never included in event payloads.
   - `OBSERVABILITY_RUNBOOK_URL` — this document's HTTPS URL.
   - `OBSERVABILITY_SERVICE_NAME` (default `fluentcheck-backend`),
     `OBSERVABILITY_ENVIRONMENT` (default `NODE_ENV`),
     `OBSERVABILITY_TIMEOUT_MS` (1–10000, default 1000).
2. Confirm delivery is not silently failing. Delivery errors are logged with
   the error name only (`Assessment initialization observability delivery
   failed`). Gaps in the dashboard with no such log lines mean no events were
   emitted, not that delivery broke.
3. Verify the pipeline end to end with a synthetic event from a
   production-equivalent environment:
   `npm run observability:synthetic-failure`. The script pushes one sanitized
   `PROMPT_MEDIA_PREPARATION_FAILED` event, which must appear on the dashboard
   and trigger the warning rule within one evaluation interval. Pass
   `--count 3` to emit a three-event burst and observe the paging rule;
   do that only against staging, or with the paging contact point detached
   from production.

## Failure classification

Failures arrive with an allowlisted `internalReason` and `failureClass` in the
log line. Anything outside the allowlist is coerced to `UNKNOWN`.

| internalReason | failureClass | Meaning | Operator action |
| --- | --- | --- | --- |
| `PROMPT_MEDIA_SIGNING_FAILED` | `PREPARATION` | The object signer rejected a presign request for Prompt media. | Check object-storage signer health and credentials; check recent key rotation. This is the alerting class. |
| `PROMPT_MEDIA_INVALID_URL` / `PROMPT_MEDIA_MISSING_METADATA` | `PREPARATION` | A prepared URL was not absolute HTTPS, or Prompt-media metadata was incomplete. | Inspect the affected Question IDs on the dashboard; reconcile Prompt media (`npm run reconcile:prompt-media`). |
| `INITIALIZATION_DEADLINE_EXCEEDED` | `TIMEOUT` | The 10-second absolute preparation deadline elapsed. | Check object-storage latency and backend resource pressure; a burst usually accompanies a storage incident. |
| `QUESTION_BANK_INCOMPLETE` | `BANK` | No Eligible question was available for every Required category. | Check Question bank coverage: retired questions, missing Prompt media, or Questions without active Tasks. |
| `ELIGIBILITY_CONFLICT` | `ELIGIBILITY_CONFLICT` | A selected record changed before persistence and retries were exhausted. | Rare and self-correcting; investigate only when it dominates the failure rate. |
| `UNKNOWN` | `UNKNOWN` | An unclassified internal error. | Correlate the `requestId` with backend application logs for the stack trace; telemetry deliberately omits provider error messages. |

## Safe retry expectations

- A failed initialization persists nothing: the Submission, manifest, and
  manifest delivery are all rolled back atomically before the event is emitted.
- Students may safely retry immediately; the API advertises `Retry-After: 5`,
  and every failed attempt returns the identical `ASSESSMENT_UNAVAILABLE` body.
- Initialization retries are bounded by design: at most three selection cycles
  inside one 10-second deadline. A student retry creates a fresh attempt; it
  is not an automatic server-side retry.
- Telemetry delivery failure cannot create, fail, or alter an initialization.
  If the observability platform is down, initialization behaves normally and
  only the delivery-error log line appears. Never "fix" a student-facing
  initialization report by changing observability configuration alone.

## What telemetry will never show

The seam is allowlisted by construction. It excludes student identity, raw
idempotency keys, storage keys, signed URLs, provider error messages,
credentials, and configuration values. `failedQuestionIds` and
`failedCategories` are safe to share; use the `requestId` to correlate to
backend application logs when deeper diagnosis is needed.

## Escalation

1. **Warning (`PromptMediaPreparationFailed`)**: on-call reviews within the
   business day. Check the failure reason on the dashboard and the
   configuration checks above. A single signing failure during a key rotation
   is expected; repeated warnings are an incident.
2. **Page (`PromptMediaPreparationFailureBurst`)**: respond immediately.
   - Confirm scope on the dashboard: all categories or one, growing or flat.
   - Most likely cause is object storage (signer or network), per the
     classification table; engage the platform owner for object storage if
     signing failures dominate.
   - If `QUESTION_BANK_INCOMPLETE` dominates, engage the content owner; no
     amount of storage work will fix an exhausted question bank.
   - Students see `ASSESSMENT_UNAVAILABLE` with `Retry-After: 5`; there is no
     data loss and nothing to repair after recovery.
3. Escalate to the engineering owner of
   `backend/src/service/manifestSubmissionInitialization.service.ts` when the
   failure class is `UNKNOWN` or when failures persist after storage and
   configuration checks pass.

The alert rules, dashboard, and datasource provisioning live in `ops/grafana/`
and are validated by `backend/test/observabilityProvisioningContract.test.ts`.
