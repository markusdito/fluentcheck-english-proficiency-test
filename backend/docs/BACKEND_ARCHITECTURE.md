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
| Persistence contract | backend/prisma/schema.prisma and backend/prisma/migrations |
| Scoring rules | backend/src/utils/scoring.ts |

## 3. Persistence and domain vocabulary

The main records are User, Question, Task, Submission, SubmissionManifest,
ManifestEntry, ManifestTask, Answer, Payment, ExaminerAssignment, Score, and
Certificate. User roles are STUDENT, EXAMINER, and ADMIN.

A new Submission has one immutable Submission manifest. The manifest selects
one eligible Question from each Required category: PART_1, PART_2, and PART_3.
Each ManifestEntry stores the selected Question identity, delivery position,
timings, prompt media metadata, and task snapshots. It remains authoritative
after the source Question changes or is retired.

An Answer attaches to a ManifestEntry for the current flow. Legacy answers may
retain the older submission/question relationship. A Verified answer is
server-observed R2 evidence bound to its manifest entry; a client declaration
alone is not sufficient.

Question eligibility for new manifest creation requires an active Question,
available prompt audio metadata, and at least one active Task. Prompt media
preparation signs a short-lived HTTPS URL from retained identity metadata. It
does not prove that a later browser request will play the object.

### Submission status

| Status | Meaning and current transition |
| --- | --- |
| IN_PROGRESS | Manifest-backed recording is open. |
| ABANDONED | The student explicitly abandons the open Submission. |
| AWAITING_PAYMENT | Completion evidence is valid and payment is required. |
| PAID | At least one validated successful Payment attempt exists; assignment is separate and retryable. |
| SCORING | Exactly two Examiner assignments exist and at least one remains incomplete. |
| SCORED | Both assignments have been finalized with complete valid Scores. |
| CERTIFIED | Schema-supported status; no current backend service or route issues a Certificate or performs this transition. |

The reachable primary path is IN_PROGRESS to AWAITING_PAYMENT to PAID to
SCORING to SCORED. An open Submission can instead become ABANDONED. If
payment is waived, valid completion enters the paid/assignment path without a
provider checkout.

### Related state records

| Record | States or invariant |
| --- | --- |
| Payment | PENDING, PAID, FAILED, or REFUNDED. Every validated success is retained as its own attempt. |
| Answer upload | PENDING, UPLOADED, or FAILED. Only an R2-confirmed UPLOADED answer with verification evidence is complete. |
| ExaminerAssignment | ASSIGNED, IN_PROGRESS, or COMPLETED. There are exactly two fixed slots, 1 and 2, with no ranking. |
| Score | RUBRIC_6 or LEGACY_100 scoring system; draft scores are mutable until assignment completion. |
| Certificate | One optional record per Submission in the schema; issuance is not currently implemented. |

## 4. HTTP route inventory

The following markers are checked against the route declarations in the
source tree by scripts/check-architecture-docs.mjs. Access descriptions name
the middleware currently enforced at the route boundary.

### Root and authentication

<!-- route: GET / | source=backend/src/server.ts -->
| GET | / | Public | Returns the API identity object. |

<!-- route: POST /api/auth/register | source=backend/src/routes/auth.routes.ts -->
| POST | /api/auth/register | Public, auth validation, registration rate limits | Creates a local account and sets a session-only auth cookie. |

<!-- route: POST /api/auth/login | source=backend/src/routes/auth.routes.ts -->
| POST | /api/auth/login | Public, auth validation, login rate limits | Authenticates a local account and sets a session or remembered auth cookie according to `rememberMe`. |

<!-- route: POST /api/auth/logout | source=backend/src/routes/auth.routes.ts -->
| POST | /api/auth/logout | Public | Clears the auth cookie. |

<!-- route: GET /api/auth/me | source=backend/src/routes/auth.routes.ts -->
| GET | /api/auth/me | Authenticated | Returns the current active account. |

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
| POST | /api/submissions | Authenticated, creation rate limits | Creates or replays a manifest-backed Submission using Idempotency-Key. |

<!-- route: GET /api/submissions/active | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/active | Authenticated | Resumes the student's active IN_PROGRESS Submission. |

<!-- route: GET /api/submissions/:id/prompts/:manifestEntryId | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/:id/prompts/:manifestEntryId | Authenticated owner | Returns authorized prompt media for a manifest entry. |

<!-- route: GET /api/submissions/:id/status | source=backend/src/routes/submission.routes.ts -->
| GET | /api/submissions/:id/status | Authenticated owner | Returns the current Submission status. |

<!-- route: POST /api/submissions/:id/abandon | source=backend/src/routes/submission.routes.ts -->
| POST | /api/submissions/:id/abandon | Authenticated owner | Abandons an open Submission. |

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

<!-- route: PUT /api/examiner/assignments/:id/scores/:answerId | source=backend/src/routes/examiner.routes.ts -->
| PUT | /api/examiner/assignments/:id/scores/:answerId | EXAMINER or ADMIN | Saves a mutable Score draft for one Answer. |

<!-- route: POST /api/examiner/assignments/:id/complete | source=backend/src/routes/examiner.routes.ts -->
| POST | /api/examiner/assignments/:id/complete | EXAMINER or ADMIN | Finalizes one assignment after complete score coverage. |

<!-- route: POST /api/examiner/assignments/:id/scores | source=backend/src/routes/examiner.routes.ts -->
| POST | /api/examiner/assignments/:id/scores | EXAMINER or ADMIN | Finalizes the assignment with a score set. |

### Administrator routes

All administrator routes require an authenticated ADMIN account.

<!-- route: GET /api/admin/users | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/users | ADMIN | Lists users. |

<!-- route: PUT /api/admin/users/:id/role | source=backend/src/routes/admin.routes.ts -->
| PUT | /api/admin/users/:id/role | ADMIN | Changes a user's role. |

<!-- route: GET /api/admin/examiners | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/examiners | ADMIN | Lists eligible examiner accounts for administration. |

<!-- route: POST /api/admin/submissions/:id/assign | source=backend/src/routes/admin.routes.ts -->
| POST | /api/admin/submissions/:id/assign | ADMIN | Creates or retries the atomic two-slot assignment set. |

<!-- route: GET /api/admin/submissions | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/submissions | ADMIN | Lists submissions for administration. |

<!-- route: GET /api/admin/submissions/:id | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/submissions/:id | ADMIN | Returns administrator submission detail. |

<!-- route: GET /api/admin/stats | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/stats | ADMIN | Returns administrator statistics. |

<!-- route: GET /api/admin/settings | source=backend/src/routes/admin.routes.ts -->
| GET | /api/admin/settings | ADMIN | Reads application settings. |

<!-- route: PUT /api/admin/settings | source=backend/src/routes/admin.routes.ts -->
| PUT | /api/admin/settings | ADMIN | Updates application settings. |

## 5. Implemented lifecycle flows

### Manifest initialization and resume

POST /api/submissions requires an idempotency key from the client. The
initialization service chooses one eligible Question per Required category,
prepares prompt media, and creates the Submission, manifest, entries, and task
snapshots in one bounded transaction. Eligibility is rechecked inside the
transaction. A repeated key replays the same Submission; a key owned by a
different student is rejected. An existing active Submission is resumed or
reported as a conflict according to the service contract.

If a complete manifest cannot be created, the service raises
ASSESSMENT_UNAVAILABLE with a retryable response and Retry-After guidance.
It does not create a partial Submission. The frontend's /active route rebuilds
the experience from stored snapshots.

### Direct-to-R2 verified answers

The answer flow has three server-visible stages:

1. The student requests a presigned URL for an owned ManifestEntry.
2. The browser sends the media bytes directly to R2 with PUT.
3. The student asks the backend to confirm; the backend HEADs the expected
   object and checks existence, non-empty size, declared MIME, key shape, and
   the 100 MB answer limit.

Only confirmation records UPLOADED, observed MIME, proof version 1, and
verifiedAt. The backend ignores client-supplied size and duration as evidence.
The current path does not use Multer, a server-side FormData upload, a 500 MB
limit, or an automatic three-attempt retry loop. A failed browser upload must
be retried by obtaining a new recording in the current frontend.

### Completion and payment

Completion locks the Submission and requires a manifest-backed row, exactly
three manifest entries, exactly one Answer per entry, and verified media for
each entry. The transition is AWAITING_PAYMENT when payment is required and
PAID when payment is waived.

The pay route creates a PENDING Payment with a unique FluentCheck merchant
reference and opens an iPaymu hosted checkout. The notification route validates
the callback signature and exact merchant reference/provider identity before
recording the outcome. Every validated successful attempt is retained. The
first success transitions AWAITING_PAYMENT to PAID and requests assignment;
later successes remain visible for Payment reconciliation.

### Exactly-two assignment set

Assignment creation runs in a serializable transaction. It selects two
distinct active eligible Examiners, locks the selected accounts, claims the
PAID Submission as SCORING, and creates slots 1 and 2 atomically. Database
uniqueness constraints protect both slot identity and examiner duplication.

Insufficient examiner capacity leaves the Submission PAID. Assignment failure
after successful payment is logged and can be retried through the administrator
assignment route. There is no one-examiner intermediate success and no
automatic queue or loop described as current behavior.

### Independent scoring finalization

Each assignment scores the delivered Answers independently. RUBRIC_6 scores
use pronunciation, fluency, vocabulary, and grammar on integer or half-band
values from 1.0 through 6.0; the overall value is the mean of the four
criteria. LEGACY_100 remains supported for historical scoring.

Finalization locks the Submission, re-reads the assignment set and Scores,
requires slots 1 and 2 plus complete Answer coverage, and commits the
assignment. Repeating a completed finalization is an ALREADY_COMPLETED
successful no-op. Invalid history fails closed. The Submission remains
SCORING after one completed assignment and becomes SCORED after both.

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
question-fetch helper remain transitional compatibility surfaces. They should
not be used as evidence that the manifest flow is absent, and they should not
be removed as part of a documentation-only change.

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
| Verified answer upload evidence | backend/test/integration/submissionCompletion.test.ts, backend/test/uploadManifest.test.ts |
| Payment attempts and callback outcomes | backend/test/integration/payment.test.ts, backend/test/payment.test.ts |
| Exactly-two assignment slots and retry | backend/test/integration/examinerAssignmentSet.test.ts, backend/test/integration/examinerAssignmentSlots.test.ts, backend/test/integration/adminAssignmentRecovery.test.ts |
| Scoring lifecycle and replay | backend/test/integration/examinerScoringCompletion.test.ts, backend/test/scoring.test.ts |
| Auth identity and active account | backend/test/integration/authCurrentAccount.test.ts, backend/test/integration/authRateLimit.test.ts |
| Login persistence modes | backend/test/integration/rememberMe.test.ts, frontend/components/auth/AuthForms.test.tsx |
| Rate-limit behavior | backend/test/integration/nonAuthRateLimit.test.ts, backend/test/rateLimitStore.test.ts |

When a route or lifecycle source changes, update this document and run
node scripts/check-architecture-docs.mjs. The human review checklist is in
docs/agents/architecture-docs.md.
