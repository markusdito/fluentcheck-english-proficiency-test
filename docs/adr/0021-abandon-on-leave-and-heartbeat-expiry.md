# Abandon on leave and on heartbeat expiry

Status: Accepted. Amends ADR-0005 (Abandonment was only explicit).

PRD FR-2.7 and FR-2.8 require that a student who leaves the Assessment cannot return to the same attempt, and that a lost connection pauses rather than silently ends it.

## Decision

- The test page posts `POST /api/submissions/:id/heartbeat` every 15 seconds while a real Submission is `IN_PROGRESS`; the server stamps `Submission.lastHeartbeatAt`.
- `pagehide` and client navigation away send the existing abandon route with `navigator.sendBeacon` (fetch `keepalive` fallback) and clear the start intent.
- A server sweep (every `SUBMISSION_ABANDON_SWEEP_INTERVAL_SECONDS`, default 30) abandons `IN_PROGRESS`, `RETAINED` Submissions whose `COALESCE(lastHeartbeatAt, createdAt)` is older than `SUBMISSION_HEARTBEAT_GRACE_SECONDS` (default 120) in one atomic UPDATE.
- A failed heartbeat shows a reconnecting state and pauses preparation; a recording interrupted by the loss is flagged `TECHNICAL_FAILURE` (#173), not replayed. A successful retry resumes the next unfinished slot with full preparation time.

## Considered Options

- **Beacon only.** Rejected: a beacon is lost when the browser closes offline or crashes.
- **Heartbeat sweep only.** Rejected: a deliberate leave would stay resumable for the whole grace window.
- **Beacon plus heartbeat sweep.** Chosen; the sweep is the backstop.

## Consequences

- A tab closed without a delivered beacon and reopened within the grace window resumes the same Submission.
- A browser crash counts as Abandonment once the grace window passes (PRD §11 open question 7).
- The grace value is provisional pending PRD §11 open question 8.
- The sweep is safe on multiple instances and serializes with upload presign/confirm row locks, so an in-flight confirmation and abandonment cannot both win.
