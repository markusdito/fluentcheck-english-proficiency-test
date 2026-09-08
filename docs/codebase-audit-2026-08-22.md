# FluentCheck full-codebase audit

**Date:** 2026-08-22

**Snapshot:** branch `dev`, commit `d4b0144`, plus the current on-disk worktree

**Verdict:** **BLOCK** for production release

## Executive summary

The repository builds and its current tests pass, but the assessment-integrity path is not safe. A student can mark an answer uploaded without sending an object to R2, then complete a submission containing only that one fabricated answer. The browser has additional races that can discard a real recording or declare an empty upload-state map complete. Retiring a question can also delete prompt audio still referenced by historical submissions.

The most important fixes are:

1. Make the server own the immutable set of questions assigned to each submission.
2. Verify uploaded objects in R2 and prevent post-completion overwrites.
3. Replace the recording/upload race with an explicit state machine that cannot advance until `MediaRecorder.onstop` has produced a non-empty blob and every assigned question is confirmed.
4. Make examiner assignment and scoring transitions concurrency-safe.
5. Upgrade the vulnerable Next.js release and add tests for the critical paths.

This is not a cosmetic “code slop” result. Three findings can cause missing or altered assessment evidence, and several concurrency paths can produce incorrect grading state.

## Scope and method

The review covered the full tracked application surface:

- 111 frontend TypeScript/JavaScript files.
- 32 authored backend source files, excluding Prisma-generated code.
- 16,521 lines of authored frontend/backend code.
- Prisma schema, migrations, seed, package manifests, route registration, configuration, tests, and architecture documentation.
- 50 tracked `backend/dist` files and 18 tracked Prisma-generated source files were inventoried but not treated as authored-code quality findings.

Review methods:

- CodeGraph architecture and call-path exploration across auth, upload, submission, payment, question delivery, admin, and examiner flows.
- Code-reviewer static heuristics, manually triaged to exclude `.next` and generated Prisma noise.
- Adversarial passes from production-breakage, new-maintainer, and security perspectives.
- Frontend lint, tests, type-check, and production build.
- Backend tests, TypeScript build, and Prisma schema validation.
- Live `npm audit --omit=dev` plus dependency-tree inspection.
- Targeted secret, suppression, unsafe API, timeout, TODO, generated-artifact, and documentation-drift scans.

The worktree was already dirty during the audit. Findings describe the current on-disk snapshot; no application source was changed by this review.

## Critical findings

### C1. A student can complete an assessment without uploading a video

**Evidence:** `backend/src/service/upload.service.ts:202-263`, `backend/src/service/upload.service.ts:270-295`, `backend/src/service/submission.service.ts:344-376`, `backend/src/controllers/upload.controller.ts:21-69`

`createPresignedUpload` creates an `Answer` row before storage succeeds. `confirmUpload` then trusts the authenticated student's request and unconditionally changes that row to `UPLOADED`; it performs no R2 `HEAD`, content-type check, size check, or non-empty-object check. `completeSubmission` only counts database rows marked `UPLOADED`.

Demonstrated exploit path:

1. Create a submission.
2. Request one presigned URL for any valid question ID.
3. Do not upload anything.
4. Call `/api/uploads/confirm` with arbitrary client-supplied size/duration.
5. Call `/api/submissions/:id/complete`.

The server sees one answer and one uploaded answer, so the attempt advances to payment/scoring without evidence.

The presigned PUT remains valid for one hour and uses a stable key. Even after a legitimate confirm and submission completion, that URL can overwrite the object examiners will review. A post-confirm `HEAD` alone does not solve that second problem.

**Required fix:** use a per-upload immutable/versioned key, validate video MIME and maximum size before signing, verify R2 metadata on confirm, store a server-observed checksum/version/size, and atomically bind that immutable object version to the answer. Completion must reject any answer whose stored object proof is absent or no longer matches.

### C2. Submission completeness means “all rows that exist,” not “all assigned questions”

**Evidence:** `backend/prisma/schema.prisma:115-130`, `backend/src/service/submission.service.ts:344-361`, `backend/src/service/upload.service.ts:226-249`

A submission does not persist the set of questions delivered to the student. The only relationship is created lazily through `Answer`. Completion compares `uploadedAnswers` with `totalAnswers`, so one uploaded row is considered a complete test. The question can be any database question accepted by the foreign key; the service does not verify that it was active or assigned to this attempt.

This is the server-side root cause behind the bypass in C1 and prevents reliable retries, audits, question-bank edits, and future randomization.

**Required fix:** create an immutable `SubmissionQuestion`/attempt manifest transactionally when the test starts, return that manifest to the client, allow uploads only for those rows, and require exactly one verified answer for every manifest row before completion.

### C3. Manual recording can be discarded or the test can complete before its last upload exists

**Evidence:** `frontend/app/test/[testId]/page.tsx:214-257`, `frontend/app/test/[testId]/page.tsx:293-318`, `frontend/app/test/[testId]/page.tsx:400-471`, `frontend/app/test/[testId]/page.tsx:639-650`, `frontend/hooks/useRecording.ts:65-79`, `frontend/hooks/useRecording.ts:103-113`

Several races converge:

- Manual stop sets the page to `stopped` immediately, but `MediaRecorder.onstop` produces the blob asynchronously.
- Upload triggering relies on an arbitrary 100 ms timeout. If the blob is still null, the effect returns and does not depend on `blob`, despite its comment claiming a blob state change will retrigger it.
- The Next/Finish button is enabled as soon as phase is `stopped`. Clicking it calls `resetRecording`, which clears `chunksRef` and can run before `onstop` assembles the blob.
- `Object.values(uploadStates).every(...)` is `true` for an empty object. The last question can therefore show “Test complete,” call the backend completion endpoint, and enable “Return to dashboard” before an upload-state entry exists.
- `submissionCompleted` is set before the request succeeds and is never reset on failure, so a transient or race-induced failure has no retry path or user-visible error.

This can silently lose a candidate's answer and misreport completion.

**Required fix:** model each question as an explicit state machine (`recording -> finalizing -> blob-ready -> signing -> uploading -> verifying -> uploaded`). Do not render Next/Finish until a non-empty blob exists. Initialize upload state for every assigned question, compute completion against the manifest length, await all upload promises, and expose retryable completion errors.

### C4. Retiring a question deletes historical prompt media

**Evidence:** `backend/src/service/question.service.ts:194-214`, `backend/src/service/upload.service.ts:179-188`, `backend/src/service/submission.service.ts:175-239`, `backend/prisma/schema.prisma:84-95`

The service calls this a soft delete that preserves historical answers, but after setting `deletedAt` it deletes the question's R2 audio object. Historical answers still reference the question and result/examiner/admin detail code still signs its stored prompt key. Those URLs then point to a deleted object.

This is irreversible historical-evidence loss when R2 deletion succeeds.

**Required fix:** never delete prompt media while any answer references the question. Retain it indefinitely under the soft-delete policy, or move it to an explicit retention/archive workflow with reference counting and audited expiry.

## High-severity findings

### H1. Test delivery is hard-coded to `order = 2`, contradicting both comments and seed data

**Evidence:** `backend/src/controllers/question.controller.ts:96-104`, `backend/src/service/question.service.ts:30-63`, `backend/src/service/question.service.ts:104-140`, `backend/prisma/seed.ts`, `backend/test/question-management.test.ts:55-79`

The code claims to retrieve one random question per category, but the controller always passes `2` and the query filters every category by that same order. The seed uses PART_1 orders 1-3, PART_2 orders 4-5, and PART_3 orders 6-8, so the supplied data cannot yield one question per category. Seeded questions also begin with prompt audio `PENDING`, which can make the authenticated delivery response empty.

The frontend only leaves `loading` when `questions.length > 0`, so an empty response produces an infinite loading screen rather than an actionable error. The test suite currently asserts the hard-coded `order: 2` query, preserving the bug.

**Required fix:** define the intended selection rule, implement it server-side, persist the selected manifest, require all categories, and return a domain error if a complete deliverable set does not exist.

### H2. Assessment prompts and storage metadata are exposed without authentication

**Evidence:** `backend/src/routes/question.routes.ts:21-31`, `backend/src/controllers/question.controller.ts:133-143`, `backend/src/service/question.service.ts:34-63`

`GET /api/questions` is public and returns question IDs, tasks/prompts, `audioStorageKey`, MIME, and upload status. Any authenticated account can also request a signed prompt URL for any active question ID through `GET /api/questions/:id/audio-url`; it is not restricted to the current attempt.

This leaks an assessment bank and makes advance harvesting straightforward. The public endpoint is dead from the current test flow (`fetchQuestions` is unused), so it adds attack surface without an active product purpose.

**Required fix:** remove or authenticate the public route, never return storage keys, and authorize prompt access against the immutable submission manifest with short-lived URLs.

### H3. The “exactly two examiners” invariant is neither enforced nor concurrency-safe

**Evidence:** `backend/prisma/schema.prisma:180-194`, `backend/src/service/examiner.service.ts:228-285`, `backend/test/request-redundancy.test.ts:143-191`

The service intentionally assigns one examiner when only one exists, despite schema/docs claiming exactly two. It selects examiners outside the transaction, does not exclude soft-deleted accounts, and performs a read-then-create sequence without a lock or database constraint limiting assignment count.

Two concurrent assignment calls can both observe zero assignments. With four or more examiners and disjoint random selections, both transactions can commit and create four rows; the existing unique constraint only prevents the same examiner from appearing twice. Conversely, one examiner is accepted and the current test explicitly treats that as success.

**Required fix:** define whether one or exactly two is valid. For exactly two, require two eligible non-deleted examiners, claim the submission with a conditional status update or row lock, and enforce the invariant in one serializable transaction (prefer a fixed two-slot model or equivalent database constraint).

### H4. Bulk score submission can regress `SCORED` back to `SCORING`

**Evidence:** `backend/src/service/examiner.service.ts:520-611`

`submitExaminerScores` completes the assignment in one transaction, then reads other assignments and updates the submission outside that transaction. A valid interleaving is:

1. Examiner A completes and reads B as incomplete.
2. Examiner B completes, sees A complete, and writes `SCORED`.
3. Examiner A writes `SCORING` from its stale branch.

The alternative `completeExaminerScoring` path performs the count and transition inside one transaction (`backend/src/service/examiner.service.ts:449-513`), so the two supported completion paths have different correctness properties.

**Required fix:** route both APIs through one transactional finalization function and derive the submission state using a lock/conditional update after the assignment write.

### H5. Authentication is missing server-side validation, throttling, and deactivation enforcement

**Evidence:** `backend/src/controllers/auth.controller.ts:6-80`, `backend/src/controllers/auth.controller.ts:98-123`, `backend/src/middleware/auth.middleware.ts:23-38`, `backend/src/middleware/role.middleware.ts:13-24`, `backend/src/routes/auth.routes.ts:1-12`

- Register/login destructure unvalidated bodies and accept arbitrary/empty values; frontend Zod validation is bypassable.
- There is no rate limiting on login, register, uploads, or payment notification routes.
- `deletedAt` is documented as account deactivation, but login, `/auth/me`, and role middleware query by ID/email without `deletedAt: null`. A deactivated account with a valid password/token remains usable.
- Register/login have no local error handling for unique username races, invalid body shapes, or database errors.

**Required fix:** add shared server schemas with size limits and normalization, generic auth failures, route-specific throttles, and a single active-user lookup used by authentication/authorization. Add integration tests before exposing OAuth or more login methods.

### H6. Admin role changes can remove the last administrator or strand grading work

**Evidence:** `backend/src/service/admin.service.ts:361-393`, `backend/src/service/admin.service.ts:396-421`

The last-admin check is a non-transactional count followed by update. With two admins, each can concurrently demote the other after both observe a count of two, leaving no admin. Role changes also allow an examiner with open assignments to become a student/admin. The assignment rows remain, but the user can no longer access examiner routes, and new assignment is blocked because assignments already exist.

**Required fix:** serialize admin demotions, enforce the invariant transactionally/database-side, and reject or explicitly reassign open examiner work before role changes.

### H7. The direct Next.js version has current high-severity advisories

**Evidence:** `frontend/package.json` pins `next` to `16.2.6`; live `npm audit --omit=dev` on 2026-08-22.

The audit reported four high-severity vulnerable frontend packages. The direct Next.js finding aggregates multiple advisories affecting versions below 16.2.11, including App Router authorization bypass, denial of service, SSRF, cache confusion, and Server Function disclosure. The audit's non-major fix target was Next.js 16.3.2. Next's bundled `postcss` and `sharp` were also flagged; `js-yaml` appears through tooling dependency paths.

Reachability varies because this app does not currently use middleware auth or Server Actions, but a production framework upgrade should not be deferred on that assumption.

**Required fix:** upgrade Next.js and its lockfile to a patched supported version, rerun build/tests/lint, and review the rewrite/proxy advisory against `next.config.ts`.

## Medium-severity findings

### M1. Payment calls can hang indefinitely and callbacks can be attributed to the wrong attempt row

**Evidence:** `backend/src/service/payment.service.ts:141-231`, `backend/src/service/payment.service.ts:234-315`

The iPaymu `fetch` has no abort timeout. A stalled provider request ties up the request indefinitely. Payment callbacks encode only `FC-{submissionId}`, then choose the newest iPaymu payment row for that submission rather than matching the provider transaction/session. A delayed successful callback for an older checkout can therefore mark the newest row paid and overwrite its `providerRef`, corrupting reconciliation even if the submission legitimately becomes paid.

Examiner assignment occurs after the payment transaction. Callback retries can consequently return an error after payment is already committed, and concurrent callbacks can race through automatic assignment.

**Fix:** add a bounded timeout/retry policy, use a unique immutable reference per payment attempt, match callbacks to that row, and make post-payment assignment an idempotent outbox/job or a safely retryable state transition.

### M2. Soft-deleted question/task positions cannot be reused

**Evidence:** `backend/prisma/schema.prisma:93-112`, `backend/src/service/question.service.ts:197-270`

Questions and tasks are soft-deleted, but uniqueness is defined across all rows: `(category, order)` and `(questionId, order)`. Retiring a row leaves it occupying the position forever, so an admin cannot create a replacement at the same order.

**Fix:** use PostgreSQL partial unique indexes for active rows (`WHERE deletedAt IS NULL`), or implement explicit restore/replacement semantics.

### M3. Test initialization creates orphan attempts and has no empty-set handling

**Evidence:** `frontend/lib/test-initialization.ts:9-26`, `frontend/app/test/[testId]/page.tsx:66-89`, `frontend/app/test/[testId]/page.tsx:137-144`

Question retrieval and submission creation run in `Promise.all`. If question retrieval fails, the submission may already exist and remain invisible because the dashboard excludes `IN_PROGRESS`. Refreshing can create unlimited orphan attempts. If retrieval succeeds with an empty list, no error is set and the page remains loading forever.

The `[testId]` route parameter is deliberately ignored, and there is no test definition/model behind it. This makes the URL imply a multi-test architecture that does not exist.

**Fix:** create and return the submission manifest in one backend operation, reject incomplete banks, enforce an active-attempt policy, and either implement test IDs or remove the parameter.

### M4. Media-device retries leak streams, animation loops, and audio contexts

**Evidence:** `frontend/hooks/useMediaDevices.ts:45-105`, `frontend/hooks/useMediaDevices.ts:107-159`, `frontend/components/hardware/CameraMicPermissionModal.tsx:42-59`

Each permission request can start a new stream, `AudioContext`, analyser, and animation-frame loop without stopping/closing the previous set. Only the latest animation-frame ID is retained, and the `AudioContext` is never stored or closed. Strict Mode/effect timing and the Retry button can trigger repeated requests.

**Fix:** stop the previous stream/RAF, disconnect nodes, close the previous `AudioContext`, guard concurrent permission requests, and test retry/unmount behavior.

### M5. Full frontend lint currently fails

**Evidence:** live `npm run lint` on 2026-08-22.

Four errors remain:

- `frontend/components/hardware/CameraMicPermissionModal.tsx:45` — synchronous state update in effect.
- `frontend/components/hardware/CameraMicPermissionModal.tsx:55` — synchronous reset updates in effect.
- `frontend/hooks/useCountdown.ts:26` — writes a ref during render.
- `frontend/hooks/useMediaDevices.ts:165` — synchronous effect path that updates state.

The build and type-check still pass, so lint is the only current executable quality gate failing.

### M6. Architecture documentation makes false security and behavior claims

**Evidence:** `backend/docs/BACKEND_ARCHITECTURE.md:99`, `backend/docs/BACKEND_ARCHITECTURE.md:217`, `backend/docs/BACKEND_ARCHITECTURE.md:316-333`, `backend/docs/BACKEND_ARCHITECTURE.md:487-498`, `backend/docs/BACKEND_ARCHITECTURE.md:584-590`, `frontend/docs/FRONTEND_ARCHITECTURE.md:66-166`, `frontend/docs/FRONTEND_ARCHITECTURE.md:400-405`, `frontend/docs/FRONTEND_ARCHITECTURE.md:753-757`, `frontend/docs/FRONTEND_ARCHITECTURE.md:803-856`

Examples include:

- Claims of a 500 MB upload limit, video MIME validation, and auth/upload rate limiting that do not exist.
- Claims that exactly two examiners are enforced.
- A Multer/FormData upload flow, retry-three-times behavior, and API endpoints that are not the current direct-R2 implementation.
- Frontend contexts, components, and test APIs that do not exist in the tree.

This is operationally dangerous because a maintainer or security reviewer can conclude controls are present when they are not.

**Fix:** replace both architecture documents with generated/current route and flow inventories, mark planned controls as planned, and add documentation checks to review criteria.

### M7. Critical workflows have almost no behavioral or concurrency coverage

**Evidence:** 12 backend tests in three files and 16 frontend tests in ten files; all passed.

Missing coverage includes:

- Auth validation, brute-force controls, cookies, deactivated users, and duplicate registration races.
- Presigned video validation, R2 confirmation, post-completion overwrite, required-answer coverage, and completion races.
- Payment signature fixtures, multiple attempts, replay/concurrency, amount/currency variants, and provider timeouts.
- Examiner assignment concurrency, exactly-two enforcement, role changes with open work, and simultaneous final scoring.
- The test page, `useRecording`, `useMediaDevices`, manual stop, last-question upload, completion failure, and navigation during upload.
- Question retirement with historical answers/media.

Some current tests reinforce defects: one examiner is asserted as a valid successful assignment, and `order: 2` is asserted as the delivery query.

### M8. Dashboard and detail reads are unbounded

**Evidence:** `backend/src/service/submission.service.ts:85-110`, `backend/src/service/submission.service.ts:165-199`

The dashboard loads every non-in-progress submission with all answers and all scores to calculate summary values in application memory. There is no pagination or limit. Long-lived users can create increasingly expensive requests, and the orphan-attempt behavior makes lifecycle data harder to manage.

**Fix:** paginate history, compute aggregates in SQL/materialized summaries, and fetch detail only when requested.

### M9. Prompt-signing failures are silently converted into prompt-less tests

**Evidence:** `backend/src/service/test-question-delivery.service.ts:28-55`

Each signing error is swallowed and replaced with `audioUrl: null`. The frontend treats a missing audio URL as a question that should begin preparation immediately. A storage/configuration outage can therefore deliver a materially incomplete assessment instead of failing initialization.

**Fix:** fail the delivery request if any selected prompt cannot be signed, emit structured diagnostics, and do not create an attempt until the full manifest is deliverable.

### M10. Certification is a promised but dead lifecycle branch

**Evidence:** `backend/prisma/schema.prisma` defines `Certificate` and `CERTIFIED`; reads exist in `backend/src/service/submission.service.ts`, while repository-wide search found no certificate creation or `CERTIFIED` transition. Marketing promises a downloadable/shareable certificate in `frontend/app/page.tsx`.

The product can reach `SCORED`, but there is no implementation that issues a certificate, uploads a PDF, transitions status, or exposes a download.

**Fix:** either implement and test certification end to end or remove the user-facing promise and dormant lifecycle until it is real.

## Maintainability and “slop” inventory

### Oversized orchestration files

The code-reviewer heuristics identified these concentration points after generated code was excluded:

| File | Lines | Main risk |
|---|---:|---|
| `frontend/app/admin/questions/page.tsx` | 864 | UI, form state, task CRUD, audio upload, grouping, and cache mutation in one page |
| `frontend/app/test/[testId]/page.tsx` | 669 | Hardware, state machine, recording, navigation, concurrent upload, and completion intertwined |
| `backend/src/service/examiner.service.ts` | 612 | Reads, media signing, assignment, scoring validation, and lifecycle transitions combined |
| `backend/src/service/admin.service.ts` | 486 | Several unrelated admin domains in one service |
| `frontend/components/examiner/ScoringPanel.tsx` | 461 | Large mutable scoring form/orchestration component |
| `backend/src/service/submission.service.ts` | 389 | Dashboard aggregation, detail hydration, completion, and assignment orchestration |
| `backend/src/service/upload.service.ts` | 379 | Question-audio and answer-video lifecycles share one service despite different controls |

These are not failures solely because of line count. They are where the verified races and inconsistent invariants live. Split by lifecycle and put state transitions behind narrow domain functions with explicit preconditions.

### Dead or misleading surface

- `frontend/lib/test-api.ts:13` exports the unused public `fetchQuestions` path.
- `frontend/types/test.ts` retains unused `TestSection`, `TestSession`, and `Recording` concepts from an earlier architecture.
- `[testId]` is unused but suppressed with ESLint.
- `backend/package.json` lists both `bcrypt` and `bcryptjs`; only `bcryptjs` is imported. `ts-node-dev` is not used by scripts. `shadcn` is placed in frontend production dependencies even though it is a CLI/tooling package.
- `backend/package.json` has `main: index.js`, but that file is not the runtime entry point.
- 50 compiled `backend/dist` files and 18 generated Prisma source files are tracked. This duplicates source, increases review noise, and creates drift risk unless a release process explicitly requires committed artifacts.
- The root `.gitignore` ignores `.github`, and no CI configuration is tracked, so the documented lint/build/test expectations are not visibly enforced in-repository.

### Style and error-contract drift

- Backend formatting/semicolons are inconsistent, especially auth/server/config files versus newer services.
- Controllers map domain errors by comparing English message strings. Renaming a message changes HTTP behavior.
- Invalid UUIDs and Prisma not-found errors often become 500s instead of stable 400/404 responses.
- Several broad catches suppress useful context, while other endpoints return raw internal error messages.
- Browser and backend `fetch` calls have no shared timeout policy; mutation helpers cannot accept an abort signal.

Use typed domain errors, shared validation schemas, a centralized Express error handler, and request helpers with explicit deadlines.

## Dependency audit details

### Frontend

`npm audit --omit=dev` reported **4 high, 0 critical** vulnerable packages:

- Direct: `next@16.2.6`; audit fix target `16.3.2`.
- Transitive under Next: `postcss@8.4.31`, `sharp@0.34.5`.
- Tooling paths: `js-yaml@4.1.1` through ESLint/shadcn.

Relevant audit advisories included:

- <https://github.com/advisories/GHSA-6gpp-xcg3-4w24>
- <https://github.com/advisories/GHSA-m99w-x7hq-7vfj>
- <https://github.com/advisories/GHSA-89xv-2m56-2m9x>
- <https://github.com/advisories/GHSA-p9j2-gv94-2wf4>
- <https://github.com/advisories/GHSA-f88m-g3jw-g9cj>

### Backend

The audit reported **5 high, 3 moderate, 1 low, 0 critical** packages. Dependency-tree inspection shows most high/moderate findings are in Prisma CLI/dev transitives (`@prisma/dev`, Hono, `deepmerge-ts`, `fast-uri`, Valibot), not the Express request path. `body-parser@2.2.2` is the runtime transitive under Express and was reported low severity. Upgrade Prisma/Express after checking their release notes and rerun the audit; do not treat the low apparent runtime reachability as a reason to leave the toolchain stale.

## Validation results

| Check | Result |
|---|---|
| Frontend `npm run lint` | **Failed:** 4 errors |
| Frontend `npm test` | Passed: 10 files, 16 tests |
| Frontend `npx tsc --noEmit` | Passed |
| Frontend `npm run build` | Passed; 13 app routes generated |
| Backend `npm test` | Passed: 12 tests |
| Backend `npm run build` | Passed |
| Backend `npx prisma validate` | Passed |
| Frontend production dependency audit | **Failed:** 4 high packages |
| Backend dependency audit | **Failed:** 9 total packages, mostly tooling transitives |
| Tracked-secret scan | No tracked credential file or obvious hard-coded secret found |
| `git diff --check` | Passed at audit time |

Passing tests and builds do not exercise C1-C4 or the concurrency findings.

## Recommended remediation order

### Phase 0: protect assessment evidence

1. Add an immutable submission-question manifest and server-side completeness invariant.
2. Redesign video upload around immutable object versions, server verification, MIME/size limits, and post-completion write prevention.
3. Replace the test-page stop/upload logic with a tested state machine; block navigation and completion until all manifest rows are verified.
4. Stop deleting prompt media referenced by answers.

### Phase 1: repair state transitions and access controls

5. Make examiner assignment exactly-two and concurrency-safe.
6. Consolidate score finalization into one transactional path.
7. Enforce active users, server-side auth validation, and rate limits.
8. Serialize admin demotions and protect open examiner assignments.
9. Restrict question/prompt delivery to an attempt manifest.

### Phase 2: production hygiene

10. Upgrade Next.js and audited dependencies.
11. Add payment timeouts, per-attempt references, and idempotent post-payment jobs.
12. Fix all lint errors and media-device cleanup.
13. Add integration/concurrency tests for every finding above, then add CI that runs lint, type-check, tests, build, Prisma validation, and dependency audit.
14. Rewrite stale architecture docs and remove dead dependencies/types/routes/artifacts.

## Adversarial verdict

- **Saboteur:** BLOCK — forged/missing uploads, recording loss, destructive media retirement, and concurrency races can corrupt production outcomes.
- **Security auditor:** BLOCK — assessment bank exposure, unenforced upload integrity, weak auth controls, deactivation bypass, and vulnerable framework dependencies remain.
- **New maintainer:** CONCERNS — large orchestration files, conflicting completion APIs, stale architecture docs, dead types/routes, and tracked generated output make safe changes unnecessarily difficult.

The single most important repair is to make the backend own an immutable attempt manifest and verified immutable media objects. Until that exists, the database status machine cannot prove that a completed submission contains the assessment evidence it claims to contain.
