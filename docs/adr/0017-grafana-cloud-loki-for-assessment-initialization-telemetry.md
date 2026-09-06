# Route assessment-initialization telemetry to Grafana Cloud Loki

Assessment-initialization diagnostics from the sanitized `submission_initialization_failed` seam are routed to Grafana Cloud Loki through the dependency-free JSON push client in `backend/src/service/assessmentInitializationObservability.service.ts`. Delivery is best-effort and fire-and-forget with a bounded timeout; a failed delivery is logged by error name only and must never change Submission initialization behavior or the stable `ASSESSMENT_UNAVAILABLE` response. Grafana-managed alert rules, the assessment-initialization dashboard, and the datasource provisioning live in `ops/grafana/`.

## Consequences

- Only allowlisted fields leave the seam: internal reason, request/correlation ID, failure count, failed Question IDs, Required categories, failure class, and preparation duration. Student identity, idempotency keys, storage keys, signed URLs, provider error messages, credentials, and configuration values are excluded by construction.
- The dashboard and alert rules in `ops/grafana/` are the production monitoring surface; instrumentation alone does not constitute monitoring until they are applied to the deployed Grafana stack.
- Every production Prompt media preparation failure raises a warning; three or more within five minutes page the responsible operator.
- `OBSERVABILITY_LOKI_URL`, `OBSERVABILITY_LOKI_USERNAME`, `OBSERVABILITY_LOKI_TOKEN`, and an HTTPS `OBSERVABILITY_RUNBOOK_URL` are required in production and validated at startup.
