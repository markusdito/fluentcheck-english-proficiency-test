# Audited Answer video access

Status: Accepted.

PRD FR-4.4 and issue #178: Answer videos are viewable only by the two assigned Examiners and Admins, the student cannot view them after the test, and every view is audited.

## Decision

- One function, `issueAnswerVideoUrl` (backend/src/service/upload.service.ts), signs every Answer video URL. Callers authorize first; the function signs a 300-second R2 URL and writes one `AnswerMediaViewEvent` in the same call. Signing failure returns null and writes nothing; an audit write failure fails the request, so no URL leaves unaudited.
- Issuing a signed URL counts as a view. R2 serves the bytes directly, so the server cannot see playback; the URL grant is the last point it controls.
- Contexts: `EXAMINER_ASSIGNMENT` (assignment detail, assigned Examiner only), `ADMIN_SUBMISSION` (Admin submission detail), `ADMIN_FLAG_REVIEW` (open-flag list, once per Answer per response, tied to the Submission's oldest open flag).
- The student submission detail no longer signs Answer videos; `videoUrl` is always null.
- `AnswerMediaViewEvent` is immutable through a BEFORE UPDATE OR DELETE trigger. `answerId` and `viewerId` are `ON DELETE SET NULL` (allowed at trigger depth > 1, like `RetentionAuditEvent`); `submissionId`, `viewerRole` and `storageKey` keep the row meaningful after a purge.
- An open flag pauses both Examiner assignments: start and Score draft save are rejected with `OPEN_FLAG`, matching finalization.

## Considered Options

- **Server-proxied streaming with per-request audit.** Rejected: it moves video bandwidth through the API for a signal the URL grant already gives.
- **Reuse `RetentionAuditEvent`.** Rejected: it requires an actor, authorization id and policy version that do not apply to a view.

## Consequences

- A page reload re-issues URLs and writes new audit rows; repeated rows are expected.
- A URL can be replayed within its 300-second window without a new audit row.
