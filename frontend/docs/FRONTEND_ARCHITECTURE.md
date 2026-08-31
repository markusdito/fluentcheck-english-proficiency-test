# FluentCheck frontend architecture

Status: current-state inventory, reviewed 2026-08-31.

This document describes the Next.js App Router application as it exists in
this repository. Source code and focused tests are authoritative. A statement
marked Planned or Compatibility is not a claim about a live user path.

## 1. Boundary and runtime

The frontend is a Next.js App Router application using React, TypeScript,
Tailwind CSS, browser MediaRecorder APIs, and native fetch. Server-rendered
and client-rendered files are mixed intentionally: pages establish route
boundaries, while recording, session queries, and interactive forms are
client-side features.

frontend/next.config.ts rewrites /backend-api/:path* to the configured backend
URL under /api. The default backend is local development on port 5001. The
rewrite is the browser boundary; frontend API modules should use relative
/backend-api paths and credentialed fetch.

The backend owns authentication, manifest selection, upload verification,
payment, Examiner assignment, scoring, and Submission status. The frontend
owns navigation, browser permissions, recording, upload orchestration, and
presentation of server state. It does not decide whether an Answer is
verified or whether a Submission is complete.

## 2. Source map

| Area | Current source |
| --- | --- |
| Root layout, route styling, and brand tokens | frontend/app/layout.tsx, frontend/app/globals.css |
| Backend fetch boundary and errors | frontend/lib/api.ts |
| Session query and redirect boundary | frontend/hooks/useSession.ts, frontend/lib/auth.ts |
| Authentication forms and OAuth | frontend/components/auth, frontend/lib/google-auth.ts |
| Dashboard and Submission display | frontend/app/dashboard/page.tsx, frontend/lib/dashboard-api.ts |
| Assessment initialization | frontend/lib/test-initialization.ts, frontend/lib/test-api.ts |
| Recording state and browser media | frontend/hooks/useRecording.ts, frontend/hooks/useMediaDevices.ts, frontend/lib/recording-state-machine.ts |
| Direct upload orchestration | frontend/lib/upload-api.ts, frontend/lib/recording-upload-state.ts |
| Examiner experience | frontend/app/examiner/assignments/[assignmentId]/page.tsx, frontend/lib/examiner-api.ts, frontend/components/examiner |
| Administrator experience | frontend/app/admin, frontend/lib/admin-api.ts, frontend/lib/question-form.ts |
| Results presentation | frontend/app/results/[submissionId]/page.tsx, frontend/components/results |
| Shared UI | frontend/components/layout, frontend/components/ui |

There is no frontend contexts directory in the current tree. Session state is
provided by a TanStack Query hook, local component state, and URL/navigation
state.

## 3. Page inventory

The following markers are checked against frontend/app/**/page.tsx by
scripts/check-architecture-docs.mjs.

<!-- page: / | source=frontend/app/page.tsx -->
| Route | Current behavior |
| --- | --- |
| / | Landing page with brand content and authentication actions. |

<!-- page: /login | source=frontend/app/login/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /login | Local login form and optional Google OAuth entry point. |

<!-- page: /signup | source=frontend/app/signup/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /signup | Local account registration form. |

<!-- page: /dashboard | source=frontend/app/dashboard/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /dashboard | Authenticated dashboard with bounded cursor-paginated Submission history, summary fields, and status navigation. |

<!-- page: /profile | source=frontend/app/profile/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /profile | Authenticated account/profile view. |

<!-- page: /test/[testId] | source=frontend/app/test/[testId]/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /test/[testId] | Manifest-backed Assessment recording experience; the route parameter is navigation context, not a test-definition lookup key. |

<!-- page: /results/[submissionId] | source=frontend/app/results/[submissionId]/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /results/[submissionId] | Submission result and score presentation for the selected Submission. |

<!-- page: /admin | source=frontend/app/admin/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /admin | Administrator overview. |

<!-- page: /admin/questions | source=frontend/app/admin/questions/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /admin/questions | Administrator Question and prompt-audio management. |

<!-- page: /admin/settings | source=frontend/app/admin/settings/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /admin/settings | Administrator application-settings view. |

<!-- page: /admin/submissions | source=frontend/app/admin/submissions/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /admin/submissions | Administrator Submission list and assignment operations. |

<!-- page: /admin/submissions/[submissionId] | source=frontend/app/admin/submissions/[submissionId]/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /admin/submissions/[submissionId] | Administrator detail, evidence, and assignment recovery view. |

<!-- page: /admin/users | source=frontend/app/admin/users/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /admin/users | Administrator user and role management; capability-removing changes preview open Examiner assignments and require distinct replacement selections before apply. |

<!-- page: /examiner/assignments/[assignmentId] | source=frontend/app/examiner/assignments/[assignmentId]/page.tsx -->
| Route | Current behavior |
| --- | --- |
| /examiner/assignments/[assignmentId] | Examiner review, media playback, draft scoring, and finalization. |

The current tree also contains layouts, loading UI, not-found UI, and static
assets. They are documented in the source map where they define behavior but
are not counted as page routes.

## 4. Session and API behavior

frontend/lib/api.ts is the single low-level request helper. It sends browser
credentials, parses the JSON API contract, exposes ApiError for failed
responses, and redirects an expired unauthenticated browser session on 401.
It does not attach a Bearer token.

frontend/hooks/useSession.ts queries GET /auth/me through the rewrite. A
required-session page redirects an absent session to /login. The server's
httpOnly cookie is the authority; the frontend does not store a JWT in
localStorage or sessionStorage.

The dashboard history request uses GET /submissions with a bounded `limit`
(the browser default is 10) and an opaque `cursor` for the next page. The
response contains summary fields and pagination metadata; the dashboard keeps
the cursor stack for Previous/Next navigation. Full Answer and Score
collections remain behind the Submission detail route.

The higher-level modules are deliberately grouped by feature:

| Module | Responsibility |
| --- | --- |
| frontend/lib/auth.ts | Auth request helpers and account response types. |
| frontend/lib/google-auth.ts | Google OAuth start/error handling. |
| frontend/lib/dashboard-api.ts | Bounded dashboard Submission summary pages, cursor navigation, and detail/status queries. |
| frontend/lib/test-initialization.ts | Idempotent manifest initialization and resume mapping. |
| frontend/lib/test-api.ts | Submission lifecycle requests plus transitional question helpers. |
| frontend/lib/upload-api.ts | Presign, direct PUT, and confirmation requests. |
| frontend/lib/question-audio-api.ts | Administrator prompt-audio requests. |
| frontend/lib/examiner-api.ts | Examiner assignment, media, score, and finalization requests. |
| frontend/lib/admin-api.ts | Administrator users, settings, questions, Submissions, and assignments. |

There are no current frontend endpoints for /api/results, /auth/profile,
/auth/password, or a separate test-definition service. Result data is loaded
for a Submission through the current dashboard/result helpers.

## 5. Assessment initialization and recording

The active student experience is an Assessment: one selected Question from each
Required category and one recorded Answer for each. The page displays the
manifest entries returned by POST /submissions and does not build a question
set from a client-side test definition.

test-initialization.ts stores one idempotency key in sessionStorage for the
browser attempt, sends it as Idempotency-Key, maps manifest entries to prompt
display data, and falls back to GET /submissions/active after a conflict. A
resume uses server-stored snapshots and already-uploaded entry identities.

The test page and its layout coordinate these visible phases:

1. Loading or resuming a Submission.
2. Preparing the browser and requesting camera/microphone permission.
3. Showing prompt audio and the webcam preview.
4. Recording one response with MediaRecorder.
5. Stopping and preparing the recorded Blob.
6. Uploading and verifying the Answer.
7. Advancing only after server confirmation, then completing the Submission.

The dynamic testId segment is retained for navigation compatibility. Current
initialization is keyed by the server-created Submission and manifest, not by
an ID embedded in the URL.

## 6. Direct-to-R2 recording upload

The browser upload sequence is:

1. upload-api.ts requests a presigned URL for the current manifest entry.
2. The browser sends the Blob directly to R2 with PUT and the declared
   Content-Type.
3. The browser calls the backend confirmation endpoint.
4. The UI marks the entry uploaded only after that confirmation succeeds.

The frontend does not stream video through Express, construct a FormData
request for the answer bytes, or treat a local Blob as proof that the object
is durable. The backend independently HEADs the object and binds verification
evidence to the Answer.

The current UI has no automatic three-attempt upload retry. Once a recording
has been consumed by the upload flow, retryUpload requires a new recording
because the prior Blob is not retained as a durable retry queue. Upload
failure remains visible as an error and does not advance the Assessment.

The backend's current media contract accepts video/webm, video/mp4, or
video/quicktime and enforces an answer limit of 100 MB. Any browser-side
feedback is only advisory; server-side R2 inspection remains authoritative.

## 7. Submission lifecycle shown by the UI

| Server state | Frontend meaning |
| --- | --- |
| IN_PROGRESS | The student can resume recording and uploading manifest entries. |
| AWAITING_PAYMENT | Recording is complete and payment is still required; provider payment behavior is backend-owned. |
| PAID | Payment is validated; Examiner assignment is a separate backend transition. |
| SCORING | The Submission is in the two-Examiner scoring process. |
| SCORED | Both Examiner assignments have been finalized and scores can be displayed. |
| ABANDONED | The student left the open attempt permanently. |
| CERTIFIED | Read/display compatibility for schema-supported data; current code has no issuance path. |

The completion request is sent only after the visible entries have successful
upload confirmation. The backend still checks exactly one verified Answer per
manifest entry, so UI state is never the source of completion truth.

Dashboard and result components render status-aware data. They do not create
certificates or advance a Submission to CERTIFIED. If a future certificate
flow is implemented, its API and status behavior must be documented as a
separate current flow.

## 8. Major components and hooks

### Layout and account

Header, AccountMenu, Wordmark, Footer, and LandingAuthActions provide the
shared shell and account navigation. Auth forms are LoginForm, SignupForm,
GoogleAuthButton, and GoogleAuthError. CameraMicPermissionModal handles the
browser permission explanation before recording.

### Assessment and media

PromptDisplay presents the manifest prompt and timing. RecordingTimer and
WebcamPreview support the active recording state. QuestionAudioPlayer presents
prompt audio. VideoPlayer and LazyAnswerMedia present stored answer media,
including examiner/admin views.

### Examiner and results

AssignmentList lists assignments. VideoReviewer presents the delivered media
and prompt context. ScoringPanel edits and submits score drafts. ScoreCard,
RubricBreakdownView, and ScaleAwareScoreDisplay render score information
without reimplementing backend scoring decisions.

### Administrator and shared UI

AudioUploadButton and AudioUploadBadge support prompt-audio administration.
The admin pages use the admin API modules and shared Table, Form, Dialog,
Select, Badge, Progress, and related UI primitives. BandGauge, Stamp, and
submission-status primitives provide domain-specific presentation.

### Hooks and state machines

useCountdown controls timed prompt display. useMediaDevices owns camera and
microphone setup. useRecording owns MediaRecorder lifecycle. useSession owns
the authenticated account query. useSubmissionStatusPolling refreshes server
status where a page needs it.

recording-state-machine.ts and recording-upload-state.ts keep recording and
upload transitions explicit and testable. They do not replace server
validation.

## 9. Styling, accessibility, and failure behavior

The global style boundary is frontend/app/globals.css. Shared UI primitives
are themed by the current FluentCheck brand tokens. Pages should compose the
existing primitives and preserve responsive layouts rather than introduce a
second component system.

Recording controls expose visible state, prompt audio has a dedicated player,
and media playback is lazy where appropriate. Permission, upload, and API
errors are surfaced to the user instead of silently advancing the flow.

An expired session is returned to login by the API boundary. A failed upload
does not mark an Answer complete. A server-side assessment-unavailable
response is an initialization failure that can be retried; it is not a
client-side empty test.

## 10. Compatibility and planned behavior

frontend/lib/test-api.ts retains legacy question-fetch helpers for
compatibility with the administrator/transitional backend routes. They are
not the primary student delivery path. The manifest initialization module is
the current path and should remain the reference for new work.

The following are not current frontend behavior: localStorage Bearer
authentication, an AuthContext or TestContext directory, a useConnectivity
hook, an /api/results endpoint, server-buffered FormData uploads, or an
automatic upload retry queue. They may be future design ideas only if
explicitly reintroduced and tested.

Certificate issuance is Planned from this frontend's perspective because the
current backend exposes no issuance operation. A future payment UI is also
backend-contract dependent; documentation must name the actual route and
state behavior when it is implemented.

## 11. Verification map

Focused tests that protect the current frontend contracts include:

| Contract | Focused tests |
| --- | --- |
| Session and API boundary | frontend/hooks/useSession.test.tsx; implementation: frontend/lib/api.ts, frontend/lib/auth.ts |
| Manifest initialization and resume | frontend/lib/test-initialization.test.ts |
| Recording transitions | frontend/lib/recording-state-machine.test.ts |
| Upload transitions | frontend/lib/recording-upload-state.test.ts |
| Media and examiner presentation | frontend/components/media/LazyAnswerMedia.test.tsx, frontend/components/examiner/VideoReviewer.test.tsx |
| Auth controls | frontend/components/auth/AuthForms.test.tsx, frontend/components/auth/GoogleAuthButton.test.tsx |
| Dashboard/admin routes | frontend/app/dashboard/page.test.tsx, frontend/lib/dashboard-api.test.ts, frontend/app/admin/questions/page.test.tsx, frontend/app/admin/submissions/[submissionId]/page.test.tsx |

Run the dependency-free page/route inventory check with
node scripts/check-architecture-docs.mjs. Review procedure and the
source-change gate are in docs/agents/architecture-docs.md.
