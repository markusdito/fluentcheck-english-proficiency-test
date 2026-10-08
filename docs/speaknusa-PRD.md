# PRD: SpeakNusa English Speaking Test (CEFR B1 · Audio Answers + Webcam Proctoring + Human Examiner Scoring)

Version: 0.3.1 (draft)
Status: Draft for review
Owner: SpeakNusa product
Source repo: FluentCheck (`fluentcheck-english-proficiency-test`)
Source spec: *CEFR B1 Speaking Assessment — Technical & Administration Rules* (catatan Risang)
Last updated: 2026-10-08

### Changes from 0.1.0

- **Test structure** (0.2.0, revised in 0.3.0): Part 1/2/3 replaced by **4 Parts** from the CEFR B1 spec. Part 1 has 2 Tasks (1A, 1B), each with its own recording; Parts 2, 3 and 4 have one recording each (**5 audio tracks** per Submission). Six equivalent **Test Sets (A–F)** with fixed content and timing.
- **Retake** (0.2.0): a student may start a new Assessment while an earlier Submission is still `AWAITING_PAYMENT`, `PAID` or `SCORING`. The review-pipeline block and its warning are removed.
- **Scoring** (0.2.0, revised in 0.3.1): one Score for the whole Submission per Examiner instead of one per Answer. **2 Examiners** score each Submission independently: each enters the 4 criteria and the overall band once. The Submission result is the **mean of the 2 Examiners' Scores**.
- **Strict exam flow** (0.3.0): recording starts automatically when preparation ends and stops automatically when speaking time ends, then advances. One take per Task: no preview, no re-record.
- **Webcam proctoring** (0.3.0): the webcam records continuously in the background for integrity, with informed consent. Video is never scored. Camera is required again.
- **Practice item** (0.3.0): one unscored sample task before Part 1.
- **Prompt audio** (0.3.0): each prompt audio may be played at most 2 times.
- **Technical failure** (0.3.0): a failure during speaking time saves the partial recording and flags it for manual review instead of scoring zero.
- **Retention** (0.3.0): audio and webcam recordings are kept only for the scoring period, then deleted (UU PDP).
- **Webcam footage for examiners** (0.3.0): both assigned Examiners see the webcam footage next to the audio on their dashboard.
- **Flagged Submissions** (0.3.0): a confirmed technical-failure or integrity flag voids the Submission and gives the student a free retake.
- **Resume vs abandon** (0.3.0): resume exists only for unexpected network loss while the test page stays open. Leaving the page on purpose (close, refresh, navigate away) abandons the Submission.

## 1. Overview

SpeakNusa is an English speaking proficiency assessment targeting **CEFR B1**, built for Indonesian high school students and graduates. A student answers spoken prompts through the browser microphone while the webcam records in the background for integrity. The audio answers are scored by a human examiner on a **1–6 band rubric**.

This PRD defines the v1 test experience end-to-end:

```
consent → system check (mic + camera + identity) → practice item →
Part 1 (1A, 1B) → Part 2 → Part 3 → Part 4 → upload → completion →
(payment / waiver) → examiner assignment → rubric scoring (1–6) → result report

any confirmed technical-failure / integrity flag → VOIDED → free retake
```

SpeakNusa reuses the FluentCheck domain model (`Submission`, `Answer`, `Examiner assignment`, `Score`). **Answers are audio-only**; the webcam stream is a separate proctoring recording that is never scored.

On every candidate-facing screen the spec's placeholder "CEFR B1 Speaking Test" is replaced by the product name, e.g. **"SPEAKNUSA SPEAKING ASSESSMENT — TEST SET A"**.

### 1.1 Goals

1. Let a student complete a full speaking assessment in ~15 minutes with a browser, headset microphone and webcam.
2. Guarantee every submitted audio answer is playable by both assigned examiners, and every technical failure is flagged rather than silently scored.
3. Produce a defensible 1–6 human score with criterion-level feedback.
4. Deter cheating (off-screen notes, translation tools) through continuous webcam proctoring.
5. Keep the recording-to-result pipeline operable by a small admin/examiner team, and delete recordings once scoring is done.

### 1.2 Non-goals (v1)

- AI / automatic scoring. All scores are entered by human examiners.
- Automated proctoring (face detection, gaze tracking). Webcam footage is reviewed by humans only.
- Reading / listening / writing sections. Speaking only.
- Mobile native apps. Browser web app only.
- Certificates with PDF generation are out of scope unless explicitly enabled (result report only).
- Cross-set score comparability before the Test Set piloting is complete (§3.4).

## 2. Target users

| Role | Needs |
| --- | --- |
| **Student** (high school student / graduate) | Clear consent and system check, a practice item, clear prompts with text + audio, automatic timed recording, confidence every track was uploaded, understandable 1–6 result, free to retake at any time. |
| **Examiner** | Queue of assigned submissions, reliable audio playback, webcam footage of the candidate next to the audio, one independent rubric entry per Submission (4 criteria + overall band, 1.0–6.0), never seeing the other Examiner's Score, written feedback, a way to raise integrity concerns, no-edit after completion. |
| **Admin** | Test Set + prompt audio management, payment control / waiver, examiner assignment (2 Examiners per Submission), reassignment, confirming or dismissing technical-failure and integrity flags, reconciliation, retention. |

Role model follows the existing system: `STUDENT`, `EXAMINER`, `ADMIN`. JWT in HTTP-only cookies, role-gated routes.

## 3. Assessment model

### 3.1 Structure

- An Assessment consists of an unscored **Practice item** followed by **4 Parts**:

  | Part | Name | Tasks | Audio track |
  | --- | --- | --- | --- |
  | Part 1 | Personal Response Tasks (short responses) | Task 1A, Task 1B | Tracks 1, 2 |
  | Part 2 | Monologue (cue card presentation) | — | Track 3 |
  | Part 3 | Structured Decision-Making Task | — | Track 4 |
  | Part 4 | Opinion & Test Wrap-Up | — | Track 5 |

- Each Task of Part 1 and each of Parts 2–4 is one **delivery slot**, giving **5 slots** per Submission: `PART_1A`, `PART_1B`, `PART_2`, `PART_3`, `PART_4` (working names, final enum names TBD).
- Every new Submission is delivered from exactly one **Test Set** (A–F). A Test Set holds exactly one Question per slot; a Submission never mixes Test Sets. Test Set maps to the existing Question set (`order`) concept.
- Each Question has one recorded **Answer** (one audio file per Question per Submission), so a Submission has **5 Answers**. Each Task of Part 1 is recorded separately with its own preparation countdown.
- Each Question has `preparationSeconds` and `recordingSeconds` (defaults in §3.2). Admin-configurable per Question.
- Prompt presentation is snapshotted per Submission (**Delivered prompt snapshot** + **Submission manifest**): prompt audio identity, onscreen text, cue card, options, and timing. Later question-bank edits never rewrite history.

### 3.2 Part specification and timing

| Slot | Prompt audio | Onscreen content | Prep | Speaking | Approx. Part time |
| --- | --- | --- | --- | --- | --- |
| Practice item | Sample prompt | Sample task + recording indicator | short | short | ~1 min |
| Part 1 · Task 1A | Personal question | One-line task text ("Task 1A: Describe …") | 10 s | 45 s | Part 1 ≈ 3 min |
| Part 1 · Task 1B | Personal question | One-line task text ("Task 1B: Explain …") | 10 s | 45 s | |
| Part 2 | Topic intro + timing ("You will now give a short talk about …") | **Cue card**: topic + 3 points to include | 60 s | 90 s | ≈ 4 min |
| Part 3 | Decision instruction ("Look at the four … options. Select the ONE option … and explain why.") | **4 options**, each a title + 2 bullets, shown as text with an icon | 60 s | 90 s | ≈ 4 min |
| Part 4 | Opinion question ("Some people believe … What is your opinion?") | One-line task text ("Task 4: Express your opinion on …") | 15 s | 60 s | ≈ 2–3 min |

Total student time target: **≈ 15 minutes**, including onboarding (1–2 min) and the practice item.

Part 3 always asks the candidate to choose **ONE** of the four options and justify it. Options are always presented as onscreen text with accompanying icons, never icons alone.

### 3.3 Test Sets A–F

| Set | 1A | 1B | Part 2 talk | Part 3 options | Part 4 opinion |
| --- | --- | --- | --- | --- | --- |
| A | Future Plans | Utility of English | Community action | Graduation projects | Vocational skills vs university degree |
| B | Digital Habits | Environmental Awareness | Preparing for future workplace changes | Eco-friendly school initiatives | Banning AI tools in assignments |
| C | Travel Experiences | Cultural Exchange | Promoting local tourism and culture | Student exchange proposals | Translation tech vs learning languages |
| D | Study Habits | Extracurricular Activities | Essential practical life skills | Learning space modernization | eBooks replacing textbooks |
| E | Physical Exercise | Stress Management | Healthy habits among teenagers | Student Wellness Week | Later school start times |
| F | Media Consumption | Creative Hobbies | Digital content creation by young people | Youth Creative Festival | Social media impact on teenagers |

Full prompt audio scripts, onscreen text, cue cards and options live in the source spec and are loaded into the question bank per set.

### 3.4 Test Set equivalence

Test Sets A–F must be **piloted** to verify equal difficulty before launch. Until piloting is done, scores from different sets are not comparable:

- Set selection rule for students (random, rotating, or avoid repeating a set on retake) is decided after piloting (§11).
- Reports and admin analytics show the Test Set next to every score.
- No cross-set comparison or ranking is presented as valid before piloting sign-off.

## 4. User journeys

### 4.1 Student

1. Sign up / log in (local or Google).
2. Dashboard → **Start new assessment**. System enforces at most one `IN_PROGRESS` Submission per student (an existing one is resumed, not duplicated). Earlier Submissions still in payment or scoring do **not** block a new Assessment and no warning is shown.
3. **Informed consent**: student reads and accepts that audio answers and a continuous webcam recording will be captured, what they are used for, who can view them, and that they are deleted after the scoring period (UU PDP). No recording starts before consent.
4. **System check** (1–2 min): welcome prompt audio plays; student grants microphone and camera permission, adjusts the headset mic, presses **Record Test** and says *"My name is [Full Name] and my Student ID is [Number]."*, plays it back, and watches the audio level meter. The **Start Assessment** button stays disabled until the system detects audio in the test clip and the camera stream is live.
5. **Practice item**: one unscored sample task to get familiar with the screen, prompt audio, countdowns and recording indicator.
6. **Parts 1–4**, for each slot in order (1A → 1B → 2 → 3 → 4):
   1. Prompt audio plays and the onscreen content appears. The student may replay the prompt audio once (2 plays total).
   2. Preparation countdown runs.
   3. Recording **starts automatically** when preparation ends. The recording countdown and indicator are visible.
   4. Recording **stops automatically** when speaking time ends and the test **advances** to the next slot. No preview, no re-record.
7. After the last slot, the **completion screen** confirms *"All 5 audio tracks successfully recorded and uploaded"*, shows the **Submission Reference ID** and status *"Saved for Evaluation"*.
8. Payment step if required (iPaymu checkout) or waiver path. Every Submission, including a retake, needs its own payment or waiver, except a free retake granted after a void (FR-2.8). A Submission that already carries a flag from the test goes to flag review before payment, so the student is never charged for a Submission that will be voided.
9. Wait for scoring → result report with the 4 criterion bands and the overall band (each the mean of the 2 Examiners) and examiner comments. If a flag is confirmed instead, the student sees the Submission as **Voided** with the reason and a **Retake for free** action.
10. If the network drops mid-test, the page shows "Connection lost — reconnecting" and pauses; once back online the test resumes at the next unfinished slot (FR-2.7).
11. Leaving the test page on purpose (closing the tab, refreshing, navigating away) **abandons** the Submission. Explicit **Abandonment** is also available while `IN_PROGRESS`. Both preserve retained evidence and allow a later Assessment start.

### 4.2 Examiner

1. Work queue shows `ASSIGNED` / `IN_PROGRESS` assignments only.
2. Open assignment → see Test Set, prompt snapshot, prompt audio, the student's 5 audio tracks, and the **webcam footage** of the candidate, synced to the track being played (server-signed, time-limited URLs; ownership + assignment checked server-side).
3. Listen to the whole Submission and enter **one Score draft** for it: 4 criterion bands + overall band + optional comment. The draft is mutable until completion.
4. If the footage or audio shows cheating (off-screen notes outside Part 2 prep, translation tools, another person helping), the Examiner raises an **integrity concern** with a timestamp and note. This pauses the assignment until an Admin confirms or dismisses it.
5. **Complete assignment**: allowed only when the Score has all 4 criteria and the overall band. Completion is terminal and idempotent; repeating completion is a no-op.
6. Exactly **2 Examiner assignments** score each Submission. The 2 Examiners work independently, have no rank, and never see each other's Score.

### 4.3 Admin

Manage users/roles, Test Sets A–F + prompt audio + Part 3 option icons, payment requirement toggle + waiver, examiner assignment (2 Examiners per Submission), reassignment of untouched `ASSIGNED` work, confirming or dismissing technical-failure and integrity flags (with access to the audio and webcam footage), payment reconciliation, retention holds / purge requests.

## 5. Functional requirements

### FR-1 Authentication & accounts

- FR-1.1 Local register/login with bcrypt-hashed passwords + Google Authorization Code + PKCE, same JWT session boundary.
- FR-1.2 `rememberMe` controls session vs 7-day persistent cookie; logout clears it.
- FR-1.3 Server-enforced roles on every route.
- FR-1.4 Student profile holds full name and Student ID used in the identity check.

### FR-2 Assessment lifecycle (Submission)

- FR-2.1 `POST` start/resume is idempotent via `SubmissionStartIntent` idempotency key; retry preserves the Submission.
- FR-2.2 Statuses: `IN_PROGRESS → AWAITING_PAYMENT → PAID → SCORING → SCORED (→ CERTIFIED if enabled)`, plus terminal `ABANDONED` and terminal `VOIDED`. A Submission with an open flag sits in `FLAG_REVIEW` (name TBD) until an Admin confirms (`VOIDED`) or dismisses (back to where it was) the flag.
- FR-2.3 **Retake is always allowed.** Starting a new Assessment is not blocked by earlier Submissions in `AWAITING_PAYMENT`, `PAID` or `SCORING`, and the dashboard shows no warning about them. Each Submission moves through payment and scoring independently. The only start rule is at most one `IN_PROGRESS` Submission per student; if one exists, start resumes it.
- FR-2.4 If Test Set selection or prompt-media preparation cannot satisfy the delivery contract, return **Assessment unavailable** with retryable vs admin-only distinction.
- FR-2.5 The dashboard lists every Submission with its own status, Test Set and result; several Submissions may be in the review pipeline at once.
- FR-2.6 Each Submission records the student's **consent** (timestamp, consent text version) before any recording starts.
- FR-2.7 **Resume is only for unexpected network loss.** While the test page stays open, the client detects connection loss (failed requests / `offline` event / heartbeat timeout), pauses the flow, and shows a reconnecting state. When the connection returns, the test resumes at the first slot without a completed Answer. A slot interrupted mid-recording is not replayed; it keeps its partial recording and technical-failure flag (FR-3.7).
- FR-2.8 **Deliberate exit abandons.** Closing the tab, refreshing, or navigating away from the test page during an `IN_PROGRESS` Submission ends it as `ABANDONED` (client sends a `pagehide` beacon; the server also abandons a Submission whose heartbeat stops without a network-loss resume within a grace period). Returning to the test route after that starts a new Assessment.
- FR-2.9 **Void + free retake.** When an Admin confirms a technical-failure or integrity flag, the Submission becomes `VOIDED` and is never scored. The student receives one **free retake credit**: the next Submission skips payment (recorded as a system waiver linked to the voided Submission). One credit per voided Submission; credits cannot be transferred to another student.

### FR-3 Audio capture & test flow (core v1 scope)

- FR-3.1 Pre-recording **media readiness** gate: microphone and camera streams must be live before the Assessment starts.
- FR-3.2 System check screen: welcome prompt audio, headset/mic instructions, permission state, **Record Test** (name + Student ID), **Playback Audio**, live **audio level** meter (device monitor — advisory only), supported-browser check. **Start Assessment** is enabled only after the system validates audio presence in the test clip.
- FR-3.3 Practice item: one unscored sample task using the real slot UI (prompt audio, prep countdown, auto-record, indicator). In v1 the practice recording is discarded on the device: not uploaded, not stored, not shown to examiners. Storing it is deferred until a concrete need appears (§11).
- FR-3.4 Prompt audio: plays automatically when a slot opens; the student may replay it **once** (2 plays max per slot). Onscreen text, cue card or options are always visible as a text alternative.
- FR-3.5 Recording via browser `MediaRecorder`:
  - Preferred mime chain: `audio/webm;codecs=opus` → `audio/webm` → browser default. Record actual `mimeType` per Answer.
  - `timeslice` ~1000 ms so partial audio survives a failure.
  - **Auto-start** when the preparation countdown reaches zero. **Auto-stop** when speaking time reaches zero, then **auto-advance** to the next slot.
  - One take per slot. No preview, no re-record.
  - States: `idle → preparing → recording → finalizing → blob-ready | partial | error`.
- FR-3.6 Per-slot UX: Part/Task header, preparation countdown and recording countdown shown side by side, clear recording indicator, auto-stop warning in the last 10 s. Part 2 instructions say the student may make brief notes on paper during preparation.
- FR-3.7 **Technical failure handling**: if audio capture or the connection fails during speaking time, the system saves the partial recording, uploads it when possible, marks the Answer `technicalFailure` with a reason, and flags the Submission for **manual review** by an Admin. A failed or silent take is never scored as zero; a confirmed flag voids the Submission with a free retake (FR-2.9).
- FR-3.8 Short or silent takes (< 2 s or < ~8 KB) are uploaded and flagged for manual review rather than blocked, since re-recording is not allowed.
- FR-3.9 Accessibility: keyboard-reachable controls, visible focus, onscreen text for every prompt audio, Part 3 options as text + icon (never icons alone), timed steps announced to assistive tech, recording status not conveyed by color alone.

### FR-4 Webcam proctoring

- FR-4.1 The webcam records **continuously in the background** from Assessment start (after consent and system check) to the last slot, to detect off-screen notes and translation tools.
- FR-4.2 The webcam recording is stored as a **Proctoring recording** linked to the Submission, separate from Answers. It is not scored on the rubric and never shown to the student after the test.
- FR-4.3 A small self-view and "camera recording" indicator stay visible during the test.
- FR-4.4 If the camera stream drops mid-test, the test continues (audio answers take priority), and the Submission is flagged for **integrity review** with the gap recorded.
- FR-4.5 Upload uses the same direct-to-storage path as audio (FR-5), in chunks so a disconnect does not lose the whole recording. The recording carries slot markers (start/stop time of each audio track) so it can be synced to the audio.
- FR-4.6 The webcam footage is shown on the **assigned Examiners'** scoring screens, next to the audio tracks, via time-limited signed URLs. Admins can also view it when reviewing a flag. No one else (other Examiners, the student) can view it. Every view is audited.
- FR-4.7 The Examiner can raise an **integrity concern** from the footage with a timestamp and note. It flags the Submission for Admin review (FR-2.9).

### FR-5 Upload & verification

- FR-5.1 Direct-to-object-storage upload (Cloudflare R2, S3-compatible) via scoped presigned URLs; large media never transits the Express server.
- FR-5.2 `Answer` stores metadata only: `storageKey`, `bucket`, `mimeType`, `sizeBytes`, `durationSeconds`, `uploadStatus (PENDING → UPLOADED / FAILED)`, `technicalFailure` flag + reason.
- FR-5.3 Server verifies object identity + required properties and binds the Answer to its **Manifest entry** (`verifiedAt`, observed mime). Only **Verified answers** count toward completion; a verified partial Answer counts but keeps its flag.
- FR-5.4 Background upload with progress and retry; the test auto-advances while prior uploads finish. The Submission cannot leave `IN_PROGRESS` until all 5 Answers are `UPLOADED` + verified. The completion screen appears only after that.
- FR-5.5 Examiner playback uses time-limited signed URLs after ownership/assignment authorization. No public URLs.

### FR-6 Test Set bank & prompt media

- FR-6.1 Admin CRUD for Test Sets and their Questions per slot: prompt audio, onscreen text, Part 2 cue card (topic + 3 points), Part 3 options (4 × title + 2 bullets + icon), prep/speaking seconds.
- FR-6.2 Eligibility: only active Questions with complete prompt media (and, for Part 3, all 4 option icons) are deliverable. A Test Set is deliverable only when all 5 slots have a deliverable Question. Incomplete sets are **Draft**.
- FR-6.3 Retire/restore preserves identity and history; retired media is a **cleanup candidate** only after every retained Answer + manifest snapshot reference check, then quarantine → irreversible deletion with audit events.
- FR-6.4 Seed data: Test Sets A–F from the source spec.

### FR-7 Payment (if enabled)

- FR-7.1 iPaymu hosted checkout per **Payment attempt** (own identity, `merchantReference`, provider session/transaction IDs).
- FR-7.2 Signed callback validation; every validated success recorded; ambiguous outcomes surfaced for **payment reconciliation** (never silently overwritten).
- FR-7.3 Admin global payment toggle + per-Submission waiver. Waived submissions skip to assignment-ready. A free retake credit from a voided Submission (FR-2.9) is applied as an automatic waiver.
- FR-7.4 Payment is per Submission. A retake started while an earlier Submission is unpaid or in scoring needs its own payment or waiver; payments never transfer between Submissions.

### FR-8 Examiner assignment

- FR-8.1 Assignment-ready = recording complete + no open flag + payment satisfied/waived + no assignment yet.
- FR-8.2 Assignment commits **exactly 2 distinct active Examiners** per Submission together (fixed, non-ranked slots 1 and 2). Too few eligible Examiners leaves the Submission unassigned; there is no one-Examiner intermediate state.
- FR-8.3 Only untouched `ASSIGNED` assignments may be reassigned (new eligible examiner, same assignment identity, immutable history). `IN_PROGRESS` work stays with its examiner.
- FR-8.4 Role/account transitions that would strand work (e.g. examiner → student, deactivation) are **capability-removing transitions** and must be blocked or migrated with admin audit.

### FR-9 Scoring & results (rubric 1–6)

- FR-9.1 Each Examiner gives each Submission **one Score** covering all 4 Parts, so a scored Submission has exactly **2 Scores**. Answers are not scored individually.
- FR-9.2 Each Score has 4 criteria — **pronunciation, fluency, vocabulary, grammar** — plus an **overall band** entered by that Examiner.
- FR-9.3 Each criterion and the overall band is a **half-band value 1.0–6.0** (`1.0, 1.5, …, 5.5, 6.0`). Anything else is rejected with a per-field message.
- FR-9.4 Each overall band is that Examiner's own judgement of the whole Submission. It is **not** derived from that Examiner's criteria; the server stores it as entered.
- FR-9.5 Submission result = the **mean of the 2 Scores**: overall band = mean of the 2 overall bands, and each criterion band = mean of the 2 Examiners' bands for that criterion. Means are not rounded to a half-band and are shown to 2 decimal places (e.g. 4.5 and 5.0 → 4.75).
- FR-9.6 **Scoring finalization** commits each completed assignment. The Submission stays `SCORING` after the first and moves to `SCORED` when both are completed.
- FR-9.7 Result report shows: overall band and 4 criterion bands (the 2-Examiner means), written feedback from both Examiners, Test Set, date, submission reference. No per-Answer breakdown, no individual Examiner Scores, and no examiner identity. Raw audio is not downloadable by the student in v1.
- FR-9.8 Scoring system tag: `RUBRIC_6` (v1). Legacy `LEGACY_100` records remain readable but are never written for new SpeakNusa submissions. Submissions scored under 0.1.0 (per-Answer Scores from 2 Examiners) remain readable with their original aggregation.
- FR-9.9 A Submission with an open technical-failure or integrity flag cannot be scored. The Admin either **dismisses** the flag (false alarm, e.g. a brief camera glitch with complete audio; scoring continues) or **confirms** it, which voids the Submission with a free retake (FR-2.9). Confirmed flags are never scored "as-is".

### FR-10 Admin, ops & data retention

- FR-10.1 Dashboards: submissions by status, technical-failure and integrity review queue, payment reconciliation queue, unassigned assignment-ready list, examiner workloads.
- FR-10.2 **Retention (UU PDP)**: audio answers and webcam recordings are kept only for the scoring period. After the Submission reaches `SCORED`, `ABANDONED` or `VOIDED` and the retention window ends, they enter the existing quarantine → audited irreversible deletion flow. Scores, rubric, feedback and audit events are kept.
- FR-10.3 Retention holds (e.g. open dispute or integrity case) pause deletion until released. Student purge requests are reasoned and approved — never instant deletes.
- FR-10.4 Assessment-start observability: log Test Set selection / preparation failures distinctly (transient vs question-bank gap) for alerting.

## 6. The 1–6 rubric (examiner-facing)

Each criterion is scored independently in half-band steps across the whole Submission. The whole-band rows below are anchors; examiners may use the half-band between two rows when the performance straddles them. Band 4–5 corresponds to the B1 target range (exact CEFR mapping TBD after piloting, §11).

| Band | Pronunciation | Fluency | Vocabulary | Grammar |
| --- | --- | --- | --- | --- |
| **6 — Confident** | Easily understood; natural stress/intonation; L1 accent never impedes. | Sustained, natural pace; hesitation only for content planning. | Wide, precise range; natural collocation; effective paraphrase. | Full range of structures with consistent accuracy; rare slips self-corrected. |
| **5 — Competent** | Generally clear; occasional mis-stress; listener effort minimal. | Mostly smooth with occasional repetition/self-correction. | Sufficient range for all Parts; some precise word choice; occasional awkwardness. | Mix of simple + complex structures; frequent accuracy; errors rarely impede. |
| **4 — Functional** | Understandable with some listener effort; recurring sound/stress patterns. | Noticeable pausing/hesitation; can sustain turns but unevenly. | Adequate for familiar topics; struggles with the Part 4 opinion task; repetition evident. | Limited complex structures; errors occur but meaning generally clear. |
| **3 — Developing** | Frequently unclear; pronunciation often obscures meaning. | Halting, fragmented; long pauses; difficult to sustain a turn. | Narrow range; frequent wrong word choice; heavy reliance on simple lexis. | Basic structures dominate; frequent errors impede meaning at times. |
| **2 — Basic** | Very difficult to understand; heavy L1 interference throughout. | Very slow with frequent breakdowns; only short utterances. | Isolated words/phrases; cannot paraphrase; constant repetition. | Little control even of basic forms; meaning often obscured. |
| **1 — Minimal** | Unintelligible or (near-)silence; no assessable speech. | Cannot produce connected speech beyond isolated words. | No productive vocabulary demonstrated. | No assessable grammatical control. |

Scoring rules for examiners:

1. Score what you hear. No penalty for accent alone — only intelligibility.
2. Listen to all 5 tracks before scoring. Each band reflects the whole Submission, not one Part.
3. Score independently: you never see the other Examiner's Score, and your Score is averaged with theirs.
4. Watch the webcam footage alongside the audio. Raise an integrity concern for off-screen notes outside Part 2 preparation, translation tools, or outside help; do not lower bands as a penalty for suspected cheating.
5. Silent / empty / unplayable audio must be flagged to admin, never scored 1. Score 1 only for genuinely assessed minimal speech.
6. The Score needs all 4 criteria + the overall band + optional comment. Incomplete rubrics cannot be submitted.
7. The overall band is your holistic judgement of the Submission. It does not have to equal the average of the 4 criteria.
8. Half-bands are encouraged (e.g. 4.5) when the sample sits between anchors.
9. Comments must reference observable behavior ("Part 2 monologue lost cohesion after 40 s") not traits ("bad English").

## 7. Result calculation (normative)

Given `RUBRIC_CRITERIA = [pronunciation, fluency, vocabulary, grammar]`:

- `isValidRubricBand(v)`: number, finite, `1 ≤ v ≤ 6`, `v * 2` integer. Applies to each criterion and to the overall band.
- One Score per Examiner assignment, and exactly 2 assignments per Submission: each Score has 4 criterion bands + `overall`, all entered by that Examiner.
- Submission `score` = `mean(score₁.overall, score₂.overall)`.
- Submission `rubric` breakdown = for each criterion `c`, `mean(score₁[c], score₂[c])`.
- The only aggregation is the mean across the 2 Examiners. No mean across Answers; an Examiner's overall band is never derived from their criteria.
- Means are kept unrounded and displayed to 2 decimal places.
- With 5 Answers × 2 Examiners = **2 Scores** (each 4 criterion marks + 1 overall band) in the standard case.
- A result is shown only when both assignments are completed; one completed Score is never shown on its own.
- Backend must reject: missing criterion, missing overall band, out-of-range / non-half-band value, more than one Score per assignment, a third assignment (or a duplicate Examiner) on the same Submission, completion without a complete Score, or finalization while a technical-failure / integrity flag is unresolved.

## 8. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Browsers | Latest Chrome, Edge, Firefox, Safari. Chrome/Edge primary for `MediaRecorder`. Graceful "unsupported browser" message otherwise. |
| Devices | Headset microphone recommended; webcam required. |
| Audio | Opus/WebM preferred; examiner playback must handle recorded mime + fallback transcode path if Safari cannot play WebM (decision needed, see §11). |
| Timing accuracy | Auto-start / auto-stop within ±250 ms of the countdown; countdowns driven by a monotonic clock, not by `setInterval` drift. |
| Performance | Presigned-URL issuance p95 < 300 ms; prompt audio start latency < 1 s on broadband; examiner audio seek responsive. |
| Upload reliability | Successful upload rate > 99%; resume/retry on transient network loss; partial recordings preserved on failure; `FAILED` state always actionable. |
| Privacy & security | Informed consent before any capture; media streams never leave the device except the recorded uploads; signed URLs short-lived; no media in logs; webcam footage limited to the assigned Examiners + Admins, every view audited; deletion after the scoring period per UU PDP. |
| Availability | "Assessment unavailable" path distinct from generic 500s; admin alert on persistent Test Set gaps. |
| Accessibility | WCAG 2.2 AA for test + scoring screens; keyboard-complete; timed steps announced to assistive tech. |

## 9. Telemetry & success metrics

- Test completion rate (started → submitted), median completion time (≈ 15 min).
- Upload success rate (> 99%), technical-failure rate per slot, system-check failure rate by browser, camera-drop rate.
- Prompt audio replay rate per slot.
- Time-to-score (submission → `SCORED`), examiner completion time, reassignment rate, flag-resolution time.
- Void rate by cause (technical failure, camera drop, examiner integrity concern), flag dismissal rate, free-retake usage.
- Network-loss resume rate vs deliberate-exit abandonment rate.
- Score distribution per Test Set (input to piloting) and per Examiner — flag drift. Gap between the 2 Examiners' overall bands per Submission — flag inconsistent pairs.
- Retake rate and number of Submissions per student in the review pipeline at once.
- Payment conversion + reconciliation backlog.
- Retention compliance: recordings past their deletion date (target 0).

## 10. Milestones (suggested)

1. **M1 — Test flow**: consent, system check (mic + camera + identity), practice item, 5-slot strict auto-record flow, prompt replay limit, presigned upload, verified answers, completion screen.
2. **M2 — Proctoring & failures**: continuous webcam recording, webcam footage on the examiner scoring screen, partial-recording capture, network-loss resume, deliberate-exit abandon, flags, admin confirm/dismiss, void + free retake credit.
3. **M3 — Pipeline**: payment/waiver, 2-examiner assignment, whole-Submission scoring UI per Examiner with the 2-Examiner mean on the report with rubric validation, unblocked retakes.
4. **M4 — Content & results**: Test Sets A–F seeded, result report, admin queues, telemetry.
5. **M5 — Hardening**: Safari playback fallback, retention/deletion automation, load + failure injection, Test Set piloting.

## 11. Open questions

1. Test Set selection rule (random, rotating, never repeat on retake) — after piloting.
2. CEFR mapping of the 1–6 bands (which bands = below B1 / B1 / above B1) — after piloting.
3. Length of the "scoring period" retention window before deletion, and what happens to recordings of Submissions that never get paid.
4. Integrity: Part 2 allows brief notes on paper while the webcam is meant to catch off-screen notes. Is paper allowed only during Part 2 preparation, or everywhere?
5. Can a student end a response early ("Done speaking"), or must every slot run to the full speaking time?
6. Practice item content and timing. Store the practice recording later? (Deferred until a concrete need, e.g. support tickets or pilot analysis.)
7. Browser crash or device power loss mid-test: currently abandons like a deliberate exit. Should it be treated as a network-loss resume instead?
8. Grace period before a silent heartbeat counts as abandonment (FR-2.8).
9. Safari WebM playback: client transcode to MP4/AAC on upload vs server transcode vs WAV fallback recording?
10. Certificate issuance (`CERTIFIED`) in v1 or report-only?
11. Payment amount / currency default (current backend default `IDR`) and waiver policy for launch?
12. When the 2 Examiners' overall bands differ a lot (e.g. by 1.5 bands or more), should a third Examiner adjudicate instead of averaging?
13. Should there be any limit on how many Submissions one student can have in the review pipeline at once, or on retake frequency?

## 12. Acceptance criteria (v1)

- [ ] Student completes consent, system check, practice item and all 4 Parts (5 audio tracks) end-to-end on Chrome and Safari.
- [ ] Start Assessment stays disabled until audio is detected in the test clip and the camera is live.
- [ ] Recording starts automatically at the end of preparation and stops + advances at the end of speaking time; no re-record is possible.
- [ ] Prompt audio cannot be played more than 2 times per slot.
- [ ] A connection or audio failure during speaking time produces a saved partial recording flagged for manual review, never an automatic zero.
- [ ] A network drop with the page still open pauses the test and resumes at the next unfinished slot; closing, refreshing or navigating away abandons the Submission.
- [ ] A confirmed flag voids the Submission, and the student's next Submission skips payment; a dismissed flag returns the Submission to the normal flow.
- [ ] Webcam records continuously during the test; footage appears on both assigned Examiners' scoring screens synced to the audio, is also viewable by Admins, is hidden from everyone else, and every view is audited.
- [ ] A camera drop mid-test does not stop the test and flags the Submission for integrity review.
- [ ] Zero submissions reach examiners with unplayable, unflagged audio.
- [ ] Examiner cannot submit an incomplete or out-of-range rubric; completed work is immutable.
- [ ] Every scored submission has exactly 2 completed assignments, each with one Score of 4 criterion bands and an Examiner-entered overall band; the result shows the mean of the 2 Scores per criterion and overall.
- [ ] Student can start a new Assessment while an earlier Submission is `AWAITING_PAYMENT`, `PAID` or `SCORING`, with no warning; both Submissions reach `SCORED` independently.
- [ ] Payment-required and waived paths both reach scoring.
- [ ] Audio and webcam recordings are deleted after the scoring period through hold → quarantine → audited deletion.

---

*Implementation notes: backend scoring helpers live in `backend/src/utils/scoring.ts` (`validateRubricValues`, `calculateRubricOverall`, `averageRubrics`, `aggregateStoredScores`); per-Answer averaging is replaced by one Score per assignment, averaged across the 2 Examiners. The 5 slots in §3.1 and Test Sets are implemented (#165, ADR-0019), and retakes during the review pipeline are allowed (#164). Examiner assignment already enforces 2 fixed slots in `backend/src/service/examiner.service.ts` (ADR-0008); #177 moves scoring from per-Answer Scores to one Score per assignment. The existing video recording hook `frontend/hooks/useRecording.ts` is the starting point for the webcam proctoring stream; answers need an audio-only variant. Data model in `backend/prisma/schema.prisma` (`Submission`, `Answer`, `ExaminerAssignment`, `Score`, `ScoringSystem.RUBRIC_6`).*
