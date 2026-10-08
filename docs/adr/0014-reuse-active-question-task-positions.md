# Reuse active Question and Task positions after retirement

Status: Accepted. Superseded in part by ADR-0018: the claim that "an incomplete restored Question is an active admin draft but is not eligible for assessment delivery" now applies only to missing Prompt media, not to the absence of Tasks.

FluentCheck treats Question and Task positions as unique only among active records. Retirement frees a position for a new record, while retired records remain retained and may share the same historical position. A replacement always receives a new identity.

Restoration is explicit and exact-identity: it returns a record to its original position, fails if that position is occupied, and never moves content or restores child records. Question and Task lifecycles remain independent. An incomplete restored Question is an active admin draft but is not eligible for assessment delivery.

PostgreSQL partial unique indexes are authoritative for active-position concurrency. The migration replaces the unconditional indexes, performs fail-closed conflict checks, and never renumbers or rewrites retired evidence. A read-only position preflight and Testcontainers migration tests provide operational evidence. Admins can opt into viewing retired records and use explicit restore actions; position conflicts return HTTP 409.

Existing manifests, Answers, source IDs, Prompt media, and historical snapshots remain unchanged. Physical deletion and purge are outside this decision.
