# PRD: SpeakNusa English Speaking Test (Audio + Human Examiner Scoring)

Version: 0.1.0 (draft)
Status: Draft for review
Owner: SpeakNusa product
Source repo: FluentCheck (`fluentcheck-english-proficiency-test`)
Last updated: 2026-09-22

## 1. Overview

SpeakNusa is an English speaking proficiency assessment. A student records **audio-only answers** through the browser microphone, submits them, and receives a human-examiner score on a **1–6 band rubric**.

This PRD defines the v1 test experience end-to-end:

```
mic check → record audio answers → upload → (payment / waiver) →
examiner assignment → rubric scoring (1–6) → result report
```

SpeakNusa reuses the FluentCheck domain model (`Submission`, `Answer`, `Examiner assignment`, `Score`) but is **audio-only**: no camera, no video preview, no video storage.

### 1.1 Goals

1. Let a student complete a full speaking assessment with only a microphone and browser.
2. Guarantee every submitted audio answer is playable by the assigned examiner.
3. Produce a defensible 1–6 human score with criterion-level feedback.
4. Keep the recording-to-result pipeline operable by a small admin/examiner team.

### 1.2 Non-goals (v1)

- AI / automatic scoring. All scores are entered by human examiners.
- Reading / listening / writing sections. Speaking only.
- Mobile native apps. Browser web app only.
- Certificates with PDF generation are out of scope unless explicitly enabled (result report only).

## 2. Target users

| Role | Needs |
| --- | --- |
| **Student** | Quick mic setup, clear prompts, timed recording, confidence the audio was captured, understandable 1–6 result. |
| **Examiner** | Queue of assigned submissions, reliable audio playback, fast per-answer rubric entry (1.0–6.0), written feedback, no-edit after completion. |
| **Admin** | Question bank + prompt audio management, payment control / waiver, examiner assignment (sets of 2), reassignment, reconciliation, retention. |

Role model follows the existing system: `STUDENT`, `EXAMINER`, `ADMIN`. JWT in HTTP-only cookies, role-gated routes.

## 3. Assessment model

### 3.1 Structure

- Every new Submission contains **exactly one Question from each required category**: `PART_1`, `PART_2`, `PART_3`.
- The three Questions form one **Question set** (same `order` value); a Submission never mixes orders.
- Each Question has one recorded **Answer** (one audio file per Question per Submission).
- Each Question may carry sub-prompts (**Tasks**) answered inside that Question's single audio recording.
- Each Question has `preparationSeconds` (default 30) and `recordingSeconds` (default 120). Admin-configurable per Question.
- Prompt presentation is snapshotted per Submission (**Delivered prompt snapshot** + **Submission manifest**): text, timing, and prompt-audio identity. Later question-bank edits never rewrite history.

### 3.2 Example timing (admin-configurable)

| Part | Style | Prep | Max recording |
| --- | --- | --- | --- |
| Part 1 | Interview / short answers | 15–30 s | 60–90 s |
| Part 2 | Long turn (cue card + Tasks) | 60 s | 120 s |
| Part 3 | Discussion / abstract | 30 s | 90–120 s |

Total student time target: **< 20 minutes** including mic check.

## 4. User journeys

### 4.1 Student

1. Sign up / log in (local or Google).
2. Dashboard → **Start new assessment**. System enforces: at most one `IN_PROGRESS` Submission per student; no new Assessment while a review-pipeline submission exists.
3. **Mic check**: grant microphone permission, speak to see input level (device monitor), play back a short test clip. Mic check failure blocks recording start but shows a fix-it path.
4. Per Question: read prompt (+ Tasks), listen to prompt audio, wait through preparation countdown, record (visible timer + auto-stop at limit), preview own audio, re-record while still `IN_PROGRESS` (only the final take is kept), confirm.
5. After all 3 Answers are verified-uploaded → Submission leaves `IN_PROGRESS`.
6. Payment step if required (iPaymu checkout) or waiver path.
7. Wait for scoring → result report with per-criterion bands, overall band, examiner comments.
8. Explicit **Abandonment** is available while `IN_PROGRESS`; it preserves retained evidence and allows a later Assessment start.

### 4.2 Examiner

1. Work queue shows `ASSIGNED` / `IN_PROGRESS` assignments only.
2. Open assignment → see prompt snapshot, prompt audio, and the student's audio per Answer (server-signed, time-limited URLs; ownership + assignment checked server-side).
3. Enter **Score draft** per Answer (4 rubric bands + optional comment). Drafts are mutable until completion.
4. **Complete assignment**: allowed only when every Answer has a complete rubric. Completion is terminal and idempotent; repeating completion is a no-op.
5. Exactly **2 independent Examiner assignments** (slots 1 and 2, no rank) score each Submission. Examiners never see each other's scores.

### 4.3 Admin

Manage users/roles, question bank + prompt audio, payment requirement toggle + waiver, examiner assignment sets, reassignment of untouched `ASSIGNED` work, payment reconciliation, retention holds / purge requests.

## 5. Functional requirements

### FR-1 Authentication & accounts

- FR-1.1 Local register/login with bcrypt-hashed passwords + Google Authorization Code + PKCE, same JWT session boundary.
- FR-1.2 `rememberMe` controls session vs 7-day persistent cookie; logout clears it.
- FR-1.3 Server-enforced roles on every route.

### FR-2 Assessment lifecycle (Submission)

- FR-2.1 `POST` start/resume is idempotent via `SubmissionStartIntent` idempotency key; retry preserves the Submission.
- FR-2.2 Statuses: `IN_PROGRESS → AWAITING_PAYMENT → PAID → SCORING → SCORED (→ CERTIFIED if enabled)`, plus terminal `ABANDONED`.
- FR-2.3 Starting a new Assessment is blocked while a review-pipeline submission exists; error must name the blocker, not a generic failure.
- FR-2.4 If question selection or prompt-media preparation cannot satisfy the delivery contract, return **Assessment unavailable** with retryable vs admin-only distinction.

### FR-3 Microphone & audio capture (core v1 scope)

- FR-3.1 Pre-recording **media readiness** gate: microphone stream must be live before any `startRecording`. No camera required.
- FR-3.2 Mic-check screen: permission state, live input-level meter (**device monitor** — advisory only, never a validity proof), supported-browser check, short test-record + playback.
- FR-3.3 Recording via browser `MediaRecorder`:
  - Preferred mime chain: `audio/webm;codecs=opus` → `audio/webm` → browser default. Record actual `mimeType` per Answer.
  - `timeslice` ~1000 ms for duration tracking; auto-stop at `recordingSeconds`; manual stop always available.
  - States: `idle → preparing → recording → finalizing → blob-ready | error`. Empty blob (0 bytes) is an `error` with retry, never an upload.
  - Handle `onerror`, device unplug mid-take, and tab-backgrounding with an explicit recoverable error.
- FR-3.4 Per-take UX: countdown for prep, elapsed/remaining timer while recording, audible/visible auto-stop warning (last 10 s), playback preview, re-record (replaces local blob; server keeps only the confirmed upload), per-Question max duration enforced client **and** server (via `durationSeconds` sanity check).
- FR-3.5 Minimum-quality bar: reject takes < 2 s or < ~8 KB with "too short / silent — please re-record"; warn (don't block) on long silence or clipping when detectable.
- FR-3.6 Accessibility: full keyboard control of start/stop/playback, visible focus, captions/text alternative for every prompt-audio clip, no mic-only status conveyed by color alone.

### FR-4 Upload & verification

- FR-4.1 Direct-to-object-storage upload (Cloudflare R2, S3-compatible) via scoped presigned URLs; large audio never transits the Express server.
- FR-4.2 `Answer` stores metadata only: `storageKey`, `bucket`, `mimeType`, `sizeBytes`, `durationSeconds`, `uploadStatus (PENDING → UPLOADED / FAILED)`.
- FR-4.3 Server verifies object identity + required properties and binds the Answer to its **Manifest entry** (`verifiedAt`, observed mime). Only **Verified answers** count toward completion.
- FR-4.4 Background upload with progress, retry, and resume-friendly UX; student may continue to the next prompt while prior upload finishes, but Submission cannot leave `IN_PROGRESS` until all Answers are `UPLOADED` + verified.
- FR-4.5 Examiner playback uses time-limited signed URLs after ownership/assignment authorization. No public URLs.

### FR-5 Prompt bank & prompt audio

- FR-5.1 Admin CRUD for Questions (category, order, prep/record seconds, prompt text, Tasks) and prompt-audio upload.
- FR-5.2 Eligibility: only active Questions with complete prompt media are deliverable. Media-less actives are **Draft** (visible, undeliverable).
- FR-5.3 Retire/restore preserves identity and history; retired media is a **cleanup candidate** only after every retained Answer + manifest snapshot reference check, then quarantine → irreversible deletion with audit events.

### FR-6 Payment (if enabled)

- FR-6.1 iPaymu hosted checkout per **Payment attempt** (own identity, `merchantReference`, provider session/transaction IDs).
- FR-6.2 Signed callback validation; every validated success recorded; ambiguous outcomes surfaced for **payment reconciliation** (never silently overwritten).
- FR-6.3 Admin global payment toggle + per-Submission waiver. Waived submissions skip to assignment-ready.

### FR-7 Examiner assignment

- FR-7.1 Assignment-ready = recording complete + payment satisfied/waived + no assignment set yet.
- FR-7.2 Assignment commits **exactly 2 distinct active Examiners** (slots 1, 2) in one transaction.
- FR-7.3 Only untouched `ASSIGNED` assignments may be reassigned (new eligible examiner, same identity + slot, immutable history). `IN_PROGRESS` work stays with its examiner.
- FR-7.4 Role/account transitions that would strand work (e.g. examiner → student, deactivation) are **capability-removing transitions** and must be blocked or migrated with admin audit.

### FR-8 Scoring & results (rubric 1–6)

- FR-8.1 Every Answer is scored on 4 criteria: **pronunciation, fluency, vocabulary, grammar**.
- FR-8.2 Each criterion is a **half-band value 1.0–6.0** (`1.0, 1.5, …, 5.5, 6.0`). Anything else is rejected with a per-criterion message.
- FR-8.3 Per-Answer overall = arithmetic mean of its 4 criteria (no rounding at write time; server derives and validates `value`).
- FR-8.4 Submission result = mean across all stored Scores; per-criterion means across all Scores; display rounded to 2 dp only (`roundScore`). No premature rounding in aggregation.
- FR-8.5 **Scoring finalization** commits one completed assignment at a time (serialized per Submission) and derives Submission status from the full set: `SCORING` until both complete, then `SCORED`.
- FR-8.6 Result report shows: overall band, 4 criterion bands, per-Answer breakdown, per-examiner anonymized means (no examiner identity to student), written feedback, date, submission reference. Raw audio is not downloadable by the student in v1 (streaming preview only).
- FR-8.7 Scoring system tag: `RUBRIC_6` (v1). Legacy `LEGACY_100` records remain readable but are never written for new SpeakNusa submissions.

### FR-9 Admin & ops

- FR-9.1 Dashboards: submissions by status, payment reconciliation queue, unassigned assignment-ready list, examiner workloads.
- FR-9.2 Retention: holds, quarantine, purge requests, and immutable audit events per existing policy. Student purge requests are reasoned and approved — never instant deletes.
- FR-9.3 Assessment-start observability: log selection/preparation failures distinctly (transient vs question-bank gap) for alerting.

## 6. The 1–6 rubric (examiner-facing)

Each criterion is scored independently in half-band steps. The whole-band rows below are anchors; examiners may use the half-band between two rows when the performance straddles them.

| Band | Pronunciation | Fluency | Vocabulary | Grammar |
| --- | --- | --- | --- | --- |
| **6 — Confident** | Easily understood; natural stress/intonation; L1 accent never impedes. | Sustained, natural pace; hesitation only for content planning. | Wide, precise range; natural collocation; effective paraphrase. | Full range of structures with consistent accuracy; rare slips self-corrected. |
| **5 — Competent** | Generally clear; occasional mis-stress; listener effort minimal. | Mostly smooth with occasional repetition/self-correction. | Sufficient range for all parts; some precise word choice; occasional awkwardness. | Mix of simple + complex structures; frequent accuracy; errors rarely impede. |
| **4 — Functional** | Understandable with some listener effort; recurring sound/stress patterns. | Noticeable pausing/hesitation; can sustain turns but unevenly. | Adequate for familiar topics; struggles with abstract Part 3; repetition evident. | Limited complex structures; errors occur but meaning generally clear. |
| **3 — Developing** | Frequently unclear; pronunciation often obscures meaning. | Halting, fragmented; long pauses; difficult to sustain a turn. | Narrow range; frequent wrong word choice; heavy reliance on simple lexis. | Basic structures dominate; frequent errors impede meaning at times. |
| **2 — Basic** | Very difficult to understand; heavy L1 interference throughout. | Very slow with frequent breakdowns; only short utterances. | Isolated words/phrases; cannot paraphrase; constant repetition. | Little control even of basic forms; meaning often obscured. |
| **1 — Minimal** | Unintelligible or (near-)silence; no assessable speech. | Cannot produce connected speech beyond isolated words. | No productive vocabulary demonstrated. | No assessable grammatical control. |

Scoring rules for examiners:

1. Score what you hear. No penalty for accent alone — only intelligibility.
2. Silent / empty / unplayable audio is **not** scored 1 silently: flag to admin for re-record or retention check; score 1 only for genuinely assessed minimal speech.
3. Every Answer needs all 4 criteria + optional comment. Incomplete rubrics cannot be submitted.
4. Half-bands are encouraged (e.g. 4.5) when the sample sits between anchors.
5. Comments must reference observable behavior ("Part 2 retell lost cohesion after 40 s") not traits ("bad English").

## 7. Result calculation (normative)

Given `RUBRIC_CRITERIA = [pronunciation, fluency, vocabulary, grammar]`:

- `isValidRubricBand(v)`: number, finite, `1 ≤ v ≤ 6`, `v * 2` integer.
- Per-score overall: `mean(4 criteria)`.
- Submission `score` (overall): `mean(all stored Score.value)`, rounded to 2 dp for display.
- Submission `rubric` breakdown: per-criterion `mean(all stored criterion values)`, each rounded to 2 dp; `overall = mean(4 means)`, rounded to 2 dp.
- With 3 Answers × 2 examiners = 6 Scores (24 criterion marks) in the standard case.
- Backend must reject: missing criterion, out-of-range / non-half-band value, duplicate `(assignmentId, answerId)`, answer outside the assignment, incomplete coverage at completion, or stored `value ≠ mean(rubric)`.

## 8. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Browsers | Latest Chrome, Edge, Firefox, Safari. Chrome/Edge primary for `MediaRecorder` audio. Graceful "unsupported browser" message otherwise. |
| Audio | Opus/WebM preferred; examiner playback must handle recorded mime + fallback transcode path if Safari cannot play WebM (server-side or client transcode — decision needed, see §11). |
| Performance | Presigned-URL issuance p95 < 300 ms; audio start latency < 1 s on broadband; examiner audio seek responsive. |
| Upload reliability | Successful upload rate > 99%; resume/retry on transient network loss; `FAILED` state always actionable. |
| Privacy & security | Mic stream never leaves device except the confirmed take upload; signed URLs short-lived; no audio in logs; retention + purge honored. |
| Availability | "Assessment unavailable" path distinct from generic 500s; admin alert on persistent question-bank gaps. |
| Accessibility | WCAG 2.2 AA for test + scoring screens; keyboard-complete; timed steps announced to assistive tech. |

## 9. Telemetry & success metrics

- Test completion rate (started → submitted), median completion time (< 20 min).
- Upload success rate (> 99%), re-record rate, mic-check failure rate by browser.
- Time-to-score (submission → `SCORED`), examiner completion time, reassignment rate.
- Score distribution + inter-rater agreement (mean absolute gap between the 2 examiners per Submission) — flag systematic divergence.
- Payment conversion + reconciliation backlog.

## 10. Milestones (suggested)

1. **M1 — Audio capture**: mic check, 3-part record/preview/re-record, presigned upload, verified answers.
2. **M2 — Pipeline**: payment/waiver, 2-examiner assignment set, scoring UI with rubric validation.
3. **M3 — Results**: aggregation, result report, admin queues, telemetry.
4. **M4 — Hardening**: Safari playback fallback, retention/purge UI, load + failure injection.

## 11. Open questions

1. Silence/clipping thresholds for the FR-3.5 warning — fixed heuristics or examiner-only judgment in v1?
2. Safari WebM playback: client transcode to MP4/AAC on upload vs server transcode vs WAV fallback recording?
3. Certificate issuance (`CERTIFIED`) in v1 or report-only?
4. Payment amount / currency default (current backend default `IDR`) and waiver policy for launch?
5. Inter-rater gap policy: flag-only, third examiner, or averaging — at what threshold?

## 12. Acceptance criteria (v1)

- [ ] Student with only a microphone completes all 3 parts end-to-end on Chrome and Safari.
- [ ] Zero submissions reach examiners with unplayable audio (verified + playable check).
- [ ] Examiner cannot submit an incomplete or out-of-range rubric; completed work is immutable.
- [ ] Every scored submission has 2 independent assignments and a 2-dp overall + criterion breakdown.
- [ ] Payment-required and waived paths both reach scoring.
- [ ] All destructive evidence operations go through hold → quarantine → audited deletion.

---

*Implementation notes: backend scoring helpers live in `backend/src/utils/scoring.ts` (`validateRubricValues`, `calculateRubricOverall`, `averageRubrics`, `aggregateStoredScores`); recording hook pattern in `frontend/hooks/useRecording.ts` (video today — SpeakNusa adds an audio-only variant); data model in `backend/prisma/schema.prisma` (`Submission`, `Answer`, `ExaminerAssignment`, `Score`, `ScoringSystem.RUBRIC_6`).*
