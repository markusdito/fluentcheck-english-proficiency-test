# FluentCheck backend architecture

Status: current-state inventory, reviewed 2026-08-31.

This document describes the Express API and the behavior implemented in this
repository. Source code, the Prisma schema, and focused tests are
authoritative. A statement marked Planned or Schema only is not an enforced
runtime behavior.

## 1. System boundary

The backend is a TypeScript Express application backed by PostgreSQL through
Prisma. It signs Cloudflare R2 object URLs through the S3-compatible API and
uses iPaymu for hosted payment checkout and notifications. Google OAuth is an
optional authentication integration enabled only when its configuration is
present.

The frontend reaches this service through its /backend-api rewrite. The
backend API prefix is /api. The only unprefixed endpoint is GET /, which
returns the API identity object. There is no /api/health endpoint.

The application is assembled in backend/src/server.ts. It installs CORS with
credentials, cookie parsing, an optional general API rate limiter, the
route routers, bounded JSON and URL-encoded parsers, non-auth array-body
rejection, and the final error handler.

## 2. Source map

| Area | Current source |
| --- | --- |
| Server composition and middleware | backend/src/server.ts |
| Authentication and persistence modes | backend/src/routes/auth.routes.ts, backend/src/controllers/auth.controller.ts, backend/src/service/auth.service.ts, backend/src/utils/jwt.ts |
| Google OAuth | backend/src/routes/google-auth.routes.ts, backend/src/controllers/googleAuth.controller.ts, backend/src/service/googleAuth.service.ts |
| Questions and prompt audio | backend/src/routes/question.routes.ts, backend/src/controllers/question.controller.ts, backend/src/service/question.service.ts |
| Direct answer upload | backend/src/routes/upload.routes.ts, backend/src/controllers/upload.controller.ts, backend/src/service/upload.service.ts |
| Submission lifecycle | backend/src/routes/submission.routes.ts, backend/src/controllers/submission.controller.ts, backend/src/service/submission.service.ts |
| Manifest creation and delivery | backend/src/service/manifestSubmissionInitialization.service.ts, backend/src/service/submissionManifest.service.ts, backend/src/service/submissionManifestDelivery.service.ts |
| Payments | backend/src/routes/payment.routes.ts, backend/src/controllers/payment.controller.ts, backend/src/service/payment.service.ts, backend/src/service/ipaymu.protocol.ts |
| Examiner assignment and scoring | backend/src/routes/examiner.routes.ts, backend/src/routes/admin.routes.ts, backend/src/controllers/examiner.controller.ts, backend/src/service/examiner.service.ts, backend/src/service/admin.service.ts |
| Submission retention and Prompt-media cleanup | backend/src/routes/admin.routes.ts, backend/src/controllers/admin.controller.ts, backend/src/service/submissionRetention.service.ts, backend/src/service/promptMediaCleanup.service.ts, backend/src/service/retentionStorage.service.ts |
| Persistence contract | backend/prisma/schema.prisma and backend/prisma/migrations |
| Scoring rules | backend/src/utils/scoring.ts |

## 3. Persistence and domain vocabulary

The main records are User, TestSet, Question, Task, Submission, SubmissionManifest,
ManifestEntry, ManifestTask, Answer, Payment, ExaminerAssignment, Score, and
Certificate. User roles are STUDENT, EXAMINER, and ADMIN.

A new Submission has one immutable version 2 Submission manifest delivered
from one Test Set. A Test Set holds at most one active Question per delivery
slot (PART_1A, PART_1B, PART_2, PART_3, PART_4; partial unique index on
testSetId/category) and is deliverable only when every slot holds an eligible
Question; otherwise it is a Draft. The manifest snapshots the Test Set id and
code and delivers the five slots in order 1A, 1B, 2, 3, 4 at positions 1..5;
database triggers enforce that shape and require a complete version 2
manifest for every new Submission. Legacy version 1 manifests (PART_1A,
PART_2, PART_3 after the PART_1 rename) remain readable but are never
delivered or completed; their Test Set is null. Question defaults for
preparation/speaking seconds follow the slot (backend/src/service/assessmentSlots.ts).
Each ManifestEntry stores the selected Question identity, delivery position,
timings, prompt media metadata, task snapshots, and the Part 2 cue card /
Part 3 options (with icon identities) as delivered. It remains authoritative
after the source Question changes or is retired.

A Part 2 Question carries a cue card (topic + 3 points) and a Part 3 Question
carries four options (title + 2 bullets + icon), both as JSON on Question and
validated in backend/src/service/questionContent.ts. Option icons are uploaded
directly to R2 under server-generated, per-upload keys and bound to their
option only after server-side HEAD inspection (image/png, jpeg or webp, at most
512 KiB). Replaced icon objects are not yet cleaned up.

An Answer attaches to a ManifestEntry for the current flow. Legacy answers may
retain the older submission/question relationship. A Verified answer is
server-observed R2 evidence bound to its manifest entry; a client declaration
alone is not sufficient.

Question eligibility for new manifest creation requires an active Question,
available prompt audio metadata, and at least one active Task; a Part 3
Question also needs all four options with verified icons. Prompt media
preparation signs a short-lived HTTPS URL from retained identity metadata. It
does not prove that a later browser request will play the object.

### Submission status

| Status | Meaning and current transition |
| --- | --- |
| IN_PROGRESS | Manifest-backed recording is open. |
| ABANDONED | The student explicitly abandons or leaves the open Submission, or the abandon sweep finds its heartbeat stale. |
| AWAITING_PAYMENT | Completion evidence is valid and payment is required. |
| PAID | At least one validated successful Payment attempt exists; assignment is separate and retryable. |
| SCORING | Exactly two Examiner assignments exist and at least one remains incomplete. |
| SCORED | Both assignments have been finalized with complete valid Scores. |
| CERTIFIED | Schema-supported status; no current backend service or route issues a Certificate or performs this transition. |
| FLAG_REVIEW | An open flag awaits an Admin. Entered on completion when a device flag exists (before payment) or from `SCORING` on an Examiner integrity concern. Blocks assignment and scoring finalization. |
| VOIDED | Terminal. An Admin confirmed a flag; never scored. One `RetakeCredit` is granted and redeemed as a system waiver on the student's next completed Submission. |

### Retention status

| Status | Meaning and current transition |
| --- | --- |
| RETAINED | Normal application access. Every new Submission starts here. |
| QUARANTINED | A dual-control purge has been approved; student, examiner, and ordinary administrator evidence access is blocked during the 30-day recovery window. |
| PURGED | The purge has crossed its irreversible boundary after every captured Answer-media deletion was confirmed by storage; the Submission row is then removed and its audit remains. |

The reachable primary path is IN_PROGRESS to AWAITING_PAYMENT to PAID to
SCORING to SCORED. An open Submission can instead become ABANDONED, either
through the abandon route (explicit action or a leave beacon) or through the
stale-heartbeat sweep. If
payment is waived, valid completion enters the paid/assignment path without a
provider checkout.

### Related state records

| Record | States or invariant |
| --- | --- |
| Payment | PENDING, PAID, FAILED, or REFUNDED. Every validated success is retained as its own attempt. |
| SubmissionPaymentWaiver | At most one row per Submission (unique `submissionId`); records the waiving Admin, the reason and the time. It is the audit record of an Admin payment waiver. |
| Answer upload | PENDING, UPLOADED, or FAILED. Only an R2-confirmed UPLOADED answer with verification evidence is complete. |
| ExaminerAssignment | ASSIGNED, IN_PROGRESS, or COMPLETED. There are exactly two fixed slots, 1 and 2, with no ranking. |
| ExaminerAssignmentReassignment | Immutable history row per assignment transfer. `reason` is an account transition or `ADMIN_REASSIGNMENT`; the nullable `note` holds the Admin's reason for a standalone reassignment. |
| Score | RUBRIC_6 or LEGACY_100 scoring system; draft scores are mutable until assignment completion. |
| Certificate | One optional record per Submission in the schema; issuance is not currently implemented. |

## 4. HTTP route inventory

The following markers are checked against the route declarations in the
source tree by scripts/check-architecture-docs.mjs. Access descriptions name
the middleware currently enforced at the route boundary.

### Root and authentication

<!-- route: GET / | source=backend/src/server.ts -->
| GET | / | Public | Returns the API identity object. |

<!-- route: GET /api/health | source=backend/src/server.ts -->
| GET | /api/health | Public | Liveness probe; returns `{ ok: true }`. |

<!-- route: POST /api/auth/register | source=backend/src/routes/auth.routes.ts -->
| POST | /api/auth/register | Public, auth validation, registration rate limits | Creates a local account and sets a session-only auth cookie. |

<!-- route: POST /api/auth/login | source=backend/src/routes/auth.routes.ts -->
| POST | /api/auth/login | Public, auth validation, login rate limits | Authenticates a local account and sets a session or remembered auth cookie according to `rememberMe`. |

<!-- route: POST /api/auth/logout | source=backend/src/routes/auth.routes.ts -->
| POST | /api/auth/logout | Public | Clears the auth cookie. |

<!-- route: GET /api/auth/me | source=backend/src/routes/auth.routes.ts -->
| GET | /api/auth/me | Authenticated | Returns the current active account. |

<!-- route: PATCH /api/auth/me | source=backend/src/routes/auth.routes.ts -->
| PATCH | /api/auth/me | Authenticated, auth validation | Sets the account's full name and Student ID (PRD FR-1.4). |

Google routes are conditionally mounted inside the auth router when Google
configuration is available.

<!-- route: GET /api/auth/google/start | source=backend/src/routes/google-auth.routes.ts -->
| GET | /api/auth/google/start | Public, OAuth IP rate limit | Starts the configured Google OAuth flow. |

<!-- route: GET /api/auth/google/callback | source=backend/src/routes/google-auth.routes.ts -->
| GET | /api/auth/google/callback | Public, OAuth IP rate limit | Completes the configured Google OAuth flow. |

### Questions and prompt media

All question routes require an authenticated ADMIN account. The /test route
is a transitional administrator-only delivery surface; the student
manifest-backed flow does not use it.

<!-- route: GET /api/questions | source=backend/src/routes/question.routes.ts -->
| GET | /api/questions | ADMIN | Lists questions for administration. |

<!-- route: GET /api/questions/test | source=backend/src/routes/question.routes.ts -->
| GET | /api/questions/test | ADMIN | Transitional test-question retrieval. |

<!-- route: GET /api/questions/admin | source=backend/src/routes/question.routes.ts -->
| GET | /api/questions/admin | ADMIN | Returns the administrator question view; `includeRetired=true` opts into retired Questions and Tasks. |

<!-- route: POST /api/questions/:id/restore | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/:id/restore | ADMIN | Restores a retired Question at its original active position. |

<!-- route: GET /api/questions/:id/audio-url | source=backend/src/routes/question.routes.ts -->
| GET | /api/questions/:id/audio-url | ADMIN | Returns an authorized URL for question audio. |

<!-- route: POST /api/questions | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions | ADMIN | Creates a Question. |

<!-- route: PUT /api/questions/:id | source=backend/src/routes/question.routes.ts -->
| PUT | /api/questions/:id | ADMIN | Updates a Question. |

<!-- route: DELETE /api/questions/:id | source=backend/src/routes/question.routes.ts -->
| DELETE | /api/questions/:id | ADMIN | Retires a Question; retained evidence is preserved. |

<!-- route: POST /api/questions/audio/presigned-url | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/audio/presigned-url | ADMIN, question-audio rate limit | Creates a direct R2 upload URL for prompt audio. |

<!-- route: POST /api/questions/audio/confirm | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/audio/confirm | ADMIN, question-audio rate limit | Confirms prompt audio after server-side R2 metadata inspection. |
<!-- route: POST /api/questions/:id/options/:index/icon/presigned-url | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/:id/options/:index/icon/presigned-url | ADMIN, question-audio rate limit | Creates a direct R2 upload URL for one Part 3 option icon; requires saved option texts. |
<!-- route: POST /api/questions/:id/options/:index/icon/confirm | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/:id/options/:index/icon/confirm | ADMIN, question-audio rate limit | Binds an uploaded icon to its option after server-side R2 metadata inspection. |

<!-- route: POST /api/questions/:id/tasks | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/:id/tasks | ADMIN | Adds a Task to a Question. |

<!-- route: PUT /api/questions/:id/tasks/:taskId | source=backend/src/routes/question.routes.ts -->
| PUT | /api/questions/:id/tasks/:taskId | ADMIN | Updates a Task. |

<!-- route: DELETE /api/questions/:id/tasks/:taskId | source=backend/src/routes/question.routes.ts -->
| DELETE | /api/questions/:id/tasks/:taskId | ADMIN | Retires/removes a Task according to the current service rules. |

<!-- route: POST /api/questions/:id/tasks/:taskId/restore | source=backend/src/routes/question.routes.ts -->
| POST | /api/questions/:id/tasks/:taskId/restore | ADMIN | Restores a retired Task at its original active position. |

### Answer uploads

<!-- route: POST /api/uploads/presigned-url | source=backend/src/routes/upload.routes.ts -->
| POST | /api/uploads/presigned-url | Authenticated student, account/IP rate limits | Validates the owned manifest entry and returns a direct R2 PUT URL. |

<!-- route: POST /api/uploads/confirm | source=backend/src/routes/upload.routes.ts -->
| POST | /api/uploads/confirm | Authenticated student, account/IP rate limits | HEADs the R2 object and binds verified media evidence to the Answer. |

### Submissions

<!-- route: GET /api/submissions | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions | Authenticated | Returns global dashboard stats and a bounded cursor-paginated summary page; answer and score detail is served by the detail route. |

The student dashboard history accepts optional `limit` and opaque `cursor`
query parameters. Results are ordered by `createdAt DESC, id DESC`, and the
response includes `pagination.limit`, `pagination.hasMore`, and
`pagination.nextCursor`. The `totalTests` and `bestScore` values remain global
to the student's retained non-IN_PROGRESS Submissions rather than being
calculated from the current page.

<!-- route: POST /api/submissions | source=backend/src/routes/submission.routes.ts -->
| POST | /api/submissions | Authenticated, creation rate limits | Creates or replays a manifest-backed Submission using Idempotency-Key; returns typed active-submission, closed-intent, or foreign-key conflicts. |

<!-- route: GET /api/submissions/practice | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/practice | Authenticated | Returns an unscored practice delivery; creates no Submission. |

<!-- route: GET /api/submissions/active | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/active | Authenticated | Resumes the student's active IN_PROGRESS Submission. |

<!-- route: GET /api/submissions/:id/prompts/:manifestEntryId | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/:id/prompts/:manifestEntryId | Authenticated owner | Returns authorized prompt media for a manifest entry. |

<!-- route: GET /api/submissions/:id/status | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/:id/status | Authenticated owner | Returns the current Submission status. |

<!-- route: POST /api/submissions/:id/abandon | source=backend/src/routes/submission.routes.ts -->
| POST | /api/submissions/:id/abandon | Authenticated owner | Abandons an open Submission under a row lock; also accepts a `navigator.sendBeacon` empty text/plain body. Repeated abandonment is an idempotent no-op and retained evidence is preserved. |

<!-- route: POST /api/submissions/:id/heartbeat | source=backend/src/routes/submission.routes.ts -->
| POST | /api/submissions/:id/heartbeat | Authenticated owner | Stamps `lastHeartbeatAt` on an IN_PROGRESS Submission and returns `submissionId`, `status`, `lastHeartbeatAt`; returns 409 SUBMISSION_NOT_IN_PROGRESS with `submissionStatus` once it is closed. |

<!-- route: POST /api/submissions/:id/flags | source=backend/src/routes/submission.routes.ts -->
| POST | /api/submissions/:id/flags | Authenticated owner | Records a `TECHNICAL_FAILURE` or `CAMERA_DROP` flag while the Submission is `IN_PROGRESS`; completion then routes it to `FLAG_REVIEW` before payment. |

<!-- route: GET /api/submissions/:id | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/:id | Authenticated owner | Returns manifest-backed detail and authorized evidence URLs. |

<!-- route: POST /api/submissions/:id/complete | source=backend/src/routes/submission.routes.ts -->
| POST | /api/submissions/:id/complete | Authenticated owner, completion rate limits | Validates exactly one verified Answer per manifest entry and closes recording. |

### Payments

<!-- route: POST /api/payments/ipaymu/notify | source=backend/src/routes/payment.routes.ts -->
| POST | /api/payments/ipaymu/notify | Provider callback, IP rate limit | Validates and records an iPaymu notification. |

<!-- route: POST /api/payments/submissions/:id/pay | source=backend/src/routes/payment.routes.ts -->
| POST | /api/payments/submissions/:id/pay | Authenticated owner, account/IP rate limits | Opens an iPaymu hosted checkout for an AWAITING_PAYMENT Submission. |

### Examiner routes

All examiner routes require an authenticated EXAMINER or ADMIN account.

<!-- route: GET /api/examiner/assignments | source=backend/src/routes/examiner.routes.ts -->
| GET | /api/examiner/assignments | EXAMINER or ADMIN | Lists the caller's examiner assignments. |

<!-- route: GET /api/examiner/assignments/:id | source=backend/src/routes/examiner.routes.ts -->
| GET | /api/examiner/assignments/:id | EXAMINER or ADMIN | Returns assignment detail and the delivered prompt snapshots. |

<!-- route: PUT /api/examiner/assignments/:id/start | source=backend/src/routes/examiner.routes.ts -->
| PUT | /api/examiner/assignments/:id/start | EXAMINER or ADMIN | Starts an assigned review. |

<!-- route: PUT /api/examiner/assignments/:id/score | source=backend/src/routes/examiner.routes.ts -->
| PUT | /api/examiner/assignments/:id/score | EXAMINER or ADMIN | Saves the Examiner's mutable whole-Submission Score draft (4 criteria + overall band). |

<!-- route: POST /api/examiner/assignments/:id/complete | source=backend/src/routes/examiner.routes.ts -->
| POST | /api/examiner/assignments/:id/complete | EXAMINER or ADMIN | Finalizes one assignment once its Score is saved; rejected with `OPEN_FLAG` while a flag is open. |

<!-- route: POST /api/examiner/assignments/:id/integrity-concerns | source=backend/src/routes/examiner.routes.ts -->
| POST | /api/examiner/assignments/:id/integrity-concerns | EXAMINER or ADMIN | The assigned Examiner flags an Answer (timestamp + note); a `SCORING` Submission pauses in `FLAG_REVIEW`. |

### Administrator routes

All administrator routes require an authenticated ADMIN account.

<!-- route: GET /api/admin/users | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/users | ADMIN | Lists users. |

<!-- route: GET /api/admin/users/:id/role-transition-preview | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/users/:id/role-transition-preview | ADMIN | Previews the open Examiner-assignment impact and eligible replacement candidates for the requested role transition (`role=STUDENT`, `EXAMINER`, or `ADMIN`). |

<!-- route: PUT /api/admin/users/:id/role | source=backend/src/routes/admin.routes.ts -->
| PUT | /api/admin/users/:id/role | ADMIN | Changes a user's role. |

<!-- route: GET /api/admin/examiners | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/examiners | ADMIN | Lists eligible examiner accounts for administration. |

<!-- route: POST /api/admin/submissions/:id/assign | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/:id/assign | ADMIN | Creates or retries the atomic two-slot assignment set. |

<!-- route: POST /api/admin/submissions/:id/payment-waiver | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/:id/payment-waiver | ADMIN | Requires `reason`; waives payment for one `AWAITING_PAYMENT` Submission, records its audited `SubmissionPaymentWaiver`, sets it to `PAID`, then requests assignment. |

<!-- route: POST /api/admin/assignments/:id/reassign | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/assignments/:id/reassign | ADMIN | Requires `examinerId` and `reason`; moves an untouched `ASSIGNED` assignment (no saved Score, Submission in `SCORING` or `FLAG_REVIEW`) to an active Examiner not already on the Submission. Repeating the same Examiner returns `ALREADY_APPLIED`. |

<!-- route: POST /api/admin/submissions/:id/purge-request | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/:id/purge-request | ADMIN | Requests a policy-eligible Submission purge and records the requester and reason. |

<!-- route: POST /api/admin/submissions/:id/retention-holds | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/:id/retention-holds | ADMIN | Creates an auditable hold that blocks purge eligibility. |

<!-- route: GET /api/admin/submissions/purge-requests/:id | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/submissions/purge-requests/:id | ADMIN | Reads purge status, captured object identities, and audit-linked outcomes. |

<!-- route: POST /api/admin/submissions/purge-requests/:id/approve | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/purge-requests/:id/approve | ADMIN | Approves a purge through independent dual control and enters the 30-day quarantine. |

<!-- route: POST /api/admin/submissions/purge-requests/:id/cancel | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/purge-requests/:id/cancel | ADMIN | Recovers a quarantined purge before storage deletion begins. |

<!-- route: POST /api/admin/submissions/purge-requests/:id/finalize | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/purge-requests/:id/finalize | ADMIN | Explicitly finalizes a due purge after storage confirms every captured Answer-media deletion. |

<!-- route: POST /api/admin/retention-holds/:id/release | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/retention-holds/:id/release | ADMIN | Releases an existing hold with an immutable audit event. |

<!-- route: GET /api/admin/submissions | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/submissions | ADMIN | Lists submissions for administration. |

<!-- route: GET /api/admin/submissions/:id | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/submissions/:id | ADMIN | Returns administrator submission detail, including `paymentWaiver` and, per assignment, `reassignable` and `reassignmentHistory`. |

<!-- route: GET /api/admin/stats | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/stats | ADMIN | Returns administrator statistics. |

<!-- route: GET /api/admin/flags | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/flags | ADMIN | Lists open flags on `FLAG_REVIEW` Submissions with signed Answer-video evidence. |

<!-- route: POST /api/admin/flags/:id/confirm | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/flags/:id/confirm | ADMIN | Requires a note; voids the Submission, supersedes its other open flags, and grants one non-transferable retake credit. |

<!-- route: POST /api/admin/flags/:id/dismiss | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/flags/:id/dismiss | ADMIN | Requires a note; once no flag is open the Submission returns to `SCORING` or to the payment/waiver route. |

<!-- route: GET /api/admin/queues | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/queues | ADMIN | Read-only `openFlags`, `paymentReconciliation` and `assignmentReady` queues; nothing is resolved automatically. |

<!-- route: GET /api/admin/test-sets | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/test-sets | ADMIN | Lists Test Sets with per-slot readiness (DRAFT or DELIVERABLE). |

<!-- route: POST /api/admin/test-sets | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/test-sets | ADMIN | Creates an empty Draft Test Set; the code is trimmed, upper-cased and unique. |

<!-- route: PUT /api/admin/test-sets/:id | source=backend/src/routes/admin.routes.ts -->
| PUT | /api/admin/test-sets/:id | ADMIN | Renames a Test Set; delivered manifests keep the code they were delivered with. |

<!-- route: GET /api/admin/settings | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/settings | ADMIN | Reads application settings. |

<!-- route: PUT /api/admin/settings | source=backend/src/routes/admin.routes.ts -->
| PUT | /api/admin/settings | ADMIN | Updates application settings. |

## 5. Implemented lifecycle flows

### Manifest initialization and resume

POST /api/submissions requires an idempotency key from the client. The
initialization service chooses one deliverable Test Set at random, takes its
eligible Question for each slot, prepares prompt media, and creates the Submission, manifest, entries, and task
snapshots in one bounded transaction. Eligibility is rechecked inside the
transaction. A repeated key replays the same Submission only while it is
IN_PROGRESS; a terminal or abandoned Submission returns
ASSESSMENT_START_INTENT_CLOSED. A key owned by a different student returns
IDEMPOTENCY_KEY_CONFLICT. An existing active Submission is resumed or
reported as ACTIVE_SUBMISSION_EXISTS, including when a concurrent different
key loses the database single-active race.

If a complete manifest cannot be created, the service raises
ASSESSMENT_UNAVAILABLE with a retryable response and Retry-After guidance.
It does not create a partial Submission. Before returning, it emits one
sanitized submission_initialization_failed event through the observability
seam (assessmentInitializationObservability.service), which forwards the
allowlisted fields to Grafana Cloud Loki on a best-effort basis; a telemetry
failure never changes the response. Pending telemetry deliveries are flushed
during graceful shutdown. The dashboard and alert rules live in ops/grafana,
with the failure runbook at docs/runbooks/assessment-initialization-failures.md.
The frontend's /active route rebuilds the experience from stored snapshots.

While a Submission is IN_PROGRESS the test page posts to the heartbeat route,
which stamps `Submission.lastHeartbeatAt`. startServer runs an abandon sweep
every SUBMISSION_ABANDON_SWEEP_INTERVAL_SECONDS (default 30). One atomic
UPDATE marks ABANDONED every IN_PROGRESS, RETAINED Submission whose
COALESCE(lastHeartbeatAt, createdAt) is older than
SUBMISSION_HEARTBEAT_GRACE_SECONDS (default 120; PRD §11 open question 8).
The statement is safe to run on several instances and serializes with the
upload presign/confirm row locks. A tab reopened within the grace window
resumes the same Submission; after it, the start intent is closed and a new
Assessment starts. See ADR-0021.

### Direct-to-R2 verified answers

The answer flow has three server-visible stages:

1. The student requests a presigned URL for an owned ManifestEntry.
2. The browser sends the media bytes directly to R2 with PUT.
3. The student asks the backend to confirm; the backend HEADs the expected
   object and checks existence, non-empty size, declared MIME, key shape, and
   the 100 MB answer limit.

Only confirmation records UPLOADED, observed MIME, proof version 1, and
verifiedAt. The backend ignores client-supplied size and duration as evidence.
Concurrent confirmations of the same pending object converge on the one
verified Answer; a late confirmer replays the committed verified state.
The current path does not use Multer, a server-side FormData upload, a 500 MB
limit, or an automatic three-attempt retry loop.

Re-recording is not allowed, so a failed, short or silent take is saved and
flagged instead of retried (PRD FR-3.7, FR-3.8). Confirmation accepts an
optional `technicalFailure: { type: "TECHNICAL_FAILURE" | "CAMERA_DROP",
reason }` (reason trimmed, 1–1000 characters, else 400) for recorder errors
and camera, microphone or connection loss. A zero-byte object is accepted only
with that client failure. An observed object under 8 KB without one is treated
as a TECHNICAL_FAILURE with reason "Recording is shorter than 8 KB; it may be
short or silent". In the same transaction as the UPLOADED update the Answer is
marked `technicalFailure` with the reason and exactly one open STUDENT_DEVICE
SubmissionFlag bound to the Answer and Manifest entry is created. The response
returns `technicalFailure` and `technicalFailureReason`; a replayed
confirmation reports the stored values without a second flag. Presigning
again resets both fields on a still-pending Answer.

### Completion and payment

Completion locks the Submission and requires a version 2 manifest, exactly
five manifest entries, exactly one Answer per entry, and verified media for
each entry. A flagged verified Answer counts toward completion, and only a
`technicalFailure` Answer may have zero bytes. An open flag sends the
Submission to FLAG_REVIEW before payment. Otherwise the transition is
AWAITING_PAYMENT when payment is required and PAID when payment is waived.

The pay route creates a PENDING Payment with a unique FluentCheck merchant
reference and opens an iPaymu hosted checkout. The notification route validates
the callback signature and exact merchant reference/provider identity before
recording the outcome. Every validated successful attempt is retained. The
first success transitions AWAITING_PAYMENT to PAID and requests assignment;
later successes remain visible for Payment reconciliation.

An Admin can instead waive payment for one AWAITING_PAYMENT Submission through
the payment-waiver route. In one transaction the route writes the unique
`SubmissionPaymentWaiver` row (Admin, reason, time), sets `paymentRequired` to
false and the status to PAID, and then requests assignment. If assignment
fails, the Submission stays PAID and is listed as assignment-ready. This audited
Admin waiver is separate from the system waiver that a Retake credit applies
automatically.

### Exactly-two assignment set

Assignment creation runs in a serializable transaction. It selects two
distinct active eligible Examiners, locks the selected accounts, claims the
PAID Submission as SCORING, and creates slots 1 and 2 atomically. Database
uniqueness constraints protect both slot identity and examiner duplication.

Insufficient examiner capacity leaves the Submission PAID. Assignment failure
after successful payment is logged and can be retried through the administrator
assignment route. There is no one-examiner intermediate success and no
automatic queue or loop described as current behavior.

An Admin can reassign one Examiner assignment through the reassign route. Only
an `ASSIGNED` assignment with no saved Score moves, and only while its
Submission is `SCORING` or `FLAG_REVIEW`; `IN_PROGRESS` and scored work stays
with its Examiner. The replacement must be an active `EXAMINER` not already on
the Submission. The assignment keeps its id and slot, and each move is written
to `ExaminerAssignmentReassignment` with reason `ADMIN_REASSIGNMENT` and the
Admin's note. The transaction uses the same lock order as account transitions
and retries on serialization contention.

### Independent scoring finalization

Each assignment records exactly one Score for the whole Submission (a Score
row with no `answerId`, unique per assignment). RUBRIC_6 Scores hold
pronunciation, fluency, vocabulary, grammar, and an Examiner-entered overall
band (stored in `value`), all half-band values from 1.0 through 6.0; the
overall band is not derived from the criteria.

Finalization locks the Submission, re-reads the assignment set and Score,
requires slots 1 and 2 plus a valid saved Score, and commits the assignment.
Repeating a completed finalization is an ALREADY_COMPLETED successful no-op.
Invalid history fails closed. The Submission remains SCORING after one
completed assignment and becomes SCORED after both.

The Submission result is the mean of the two Examiners' Scores: overall band =
mean of the two overall bands, each criterion = mean of the two Examiners'
bands, unrounded to half-bands. Nothing is shown until both assignments are
completed. Submissions scored per Answer before this change (and LEGACY_100)
keep their original per-Answer aggregation.

### Admin review queues

`GET /api/admin/queues` returns three read-only lists, each capped and ordered
oldest first:

- `openFlags`: unresolved flags on `FLAG_REVIEW` Submissions.
- `paymentReconciliation`: PENDING Payment attempts older than one hour, tagged
  `CHECKOUT_UNCONFIRMED` when no provider session exists or
  `NO_PROVIDER_OUTCOME` when a session exists but no final notification arrived;
  `DUPLICATE_PAYMENT` for more than one PAID attempt on one Submission; and
  `PAID_WHILE_WAIVED` for PAID attempts on a Submission that did not need payment.
- `assignmentReady`: PAID Submissions with no Examiner assignment and no open
  flag, including waived ones.

Reading the queues changes nothing, and nothing in them is resolved
automatically. Payment reconciliation items have no resolving route yet.

## 6. Authentication, authorization, and request protection

Local authentication normalizes the email key by trimming and lowercasing it,
keeps the display email separately, and uses bcryptjs password verification.
The JWT is stored only in an httpOnly cookie named jwt. The server reads no
Bearer header. Local login accepts an optional boolean `rememberMe`; omitted or
false selects `session`, which uses the configured `JWT_EXPIRES_IN` value
(one hour by default) and a browser-session cookie with no `Max-Age` or
`Expires`. True selects `remembered`, which uses
`REMEMBERED_SESSION_SECONDS` (604800 seconds by default) for both the JWT and
the persistent cookie. Registration and Google OAuth explicitly select
session-only persistence. Both modes retain the jwt cookie name, httpOnly and
production secure flags, `SameSite=Lax`, root path, and logout clearing
behavior.

Invalid or deactivated sessions are cleared and rejected; current-account
lookup requires deletedAt to be null.

Role middleware protects administrator and examiner routers. Student-owned
routes verify the account-to-record relationship in their services.

The server accepts JSON and URL-encoded bodies up to 64 KB, limits URL-encoded
parameters, and rejects non-auth JSON arrays. Dedicated route-boundary
limiters cover authentication, Google OAuth, answer/audio operations,
submission creation/completion, payment operations, and the public payment
notification; an optional general /api limiter fills the baseline. The
MemoryStore is single-process only, so distributed deployments require the
configured shared Redis/Valkey protocol store. Sensitive limiter-store
failures fail closed.

## 7. Compatibility and non-current behavior

Legacy Submissions and legacy Answers remain readable through compatibility
branches. They are not reconstructed from a current Question bank. New
student Submissions use the manifest contract.

The administrator question delivery endpoints and the frontend legacy
question-fetch helper remain transitional compatibility surfaces. The active
administrator list is not restricted to the historical order-two position,
while the `/test` route remains a transitional administrator-only delivery
surface. These endpoints should not be used as evidence that the manifest flow
is absent, and they should not be removed as part of a documentation-only
change.

Certificate is a schema-supported concept and read models can expose existing
certificate fields, but this repository currently has no certificate issuance
service, transition, or endpoint. Any future issuance design is Planned until
implemented and tested.

The following historical claims are not current behavior: Multer or server
buffered video uploads, a 500 MB answer limit, client-trusted MIME/size,
Midtrans checkout, Bearer-token sessions, public student question delivery,
automatic upload retries, and an automatic certificate step.

## 8. Verification map

Focused tests that protect the main contracts include:

| Contract | Focused tests |
| --- | --- |
| Manifest selection, snapshots, and persistence | backend/test/integration/manifestSubmissionInitialization.test.ts, backend/test/integration/submissionManifestPersistence.test.ts, backend/test/submissionManifestDelivery.test.ts |
| Test Sets and five-slot migration | backend/test/integration/testSets.test.ts, backend/test/integration/testSetMigration.test.ts |
| Verified answer upload evidence | backend/test/integration/answerUploadIntegrity.test.ts, backend/test/integration/submissionCompletion.test.ts, backend/test/uploadManifest.test.ts |
| Legacy question-list and delivery boundaries | backend/test/integration/questionLifecycle.test.ts, backend/test/question-management.test.ts, backend/test/integration/manifestSubmissionInitialization.test.ts |
| Payment attempts and callback outcomes | backend/test/integration/payment.test.ts, backend/test/payment.test.ts |
| Exactly-two assignment slots and retry | backend/test/integration/examinerAssignmentSet.test.ts, backend/test/integration/examinerAssignmentSlots.test.ts, backend/test/integration/adminAssignmentRecovery.test.ts |
| Scoring lifecycle and replay | backend/test/integration/examinerScoringCompletion.test.ts, backend/test/scoring.test.ts |
| Auth identity and active account | backend/test/integration/authCurrentAccount.test.ts, backend/test/integration/authRateLimit.test.ts |
| Login persistence modes | backend/test/integration/rememberMe.test.ts, frontend/components/auth/AuthForms.test.tsx |
| Rate-limit behavior | backend/test/integration/nonAuthRateLimit.test.ts, backend/test/rateLimitStore.test.ts |
| Retention, purge, audit, and Prompt-media cleanup | backend/test/integration/submissionRetention.test.ts, backend/test/promptMediaCleanup.test.ts |

When a route or lifecycle source changes, update this document and run
node scripts/check-architecture-docs.mjs. The human review checklist is in
docs/agents/architecture-docs.md.
