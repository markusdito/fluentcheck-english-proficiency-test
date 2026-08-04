# Question Audio Prompt Migration

Change the spoken question from text (`promptText`) to a recorded audio file stored in the same R2 bucket as student videos. `Task.promptText` stays text.

## Decision
- Question → audio file in R2 (key: `questions/{questionId}/prompt.webm`)
- Task → unchanged, text only
- Admin upload flow: presigned PUT (reuse student-video pattern), no server bandwidth
- Audio played on test page, examiner review, results page

## Schema change
`Question`: drop `promptText`; add `audioStorageKey String?`, `audioMimeType String?`, `audioSizeBytes Int?`, `audioUploadStatus UploadStatus @default(PENDING)`.

Migration: `prisma migrate dev --name question_audio_prompt` + `prisma generate`.

**Data caveat**: existing rows lose prompt text; audio must be re-recorded per question.

## API
| Route | Auth | Body/Params |
|---|---|---|
| `POST /api/questions/audio/presigned-url` | ADMIN | `{ questionId, mimeType }` |
| `POST /api/questions/audio/confirm` | ADMIN | `{ questionId, sizeBytes? }` |
| `GET /api/questions/:id/audio-url` | authed | — |

Key format: `questions/{questionId}/prompt.webm` (server-generated only).
Validation regex: `^questions\/[0-9a-f-]{36}\/prompt\.(webm|mp3|m4a|ogg)$`
MIME allowlist: `^audio/(webm|mpeg|mp4|ogg|m4a)$`

## Security checks (after each update)
1. UUID + mime allowlist on every write
2. ADMIN-only writes; authed reads
3. Server-generated keys only; stored key re-validated (regex + bucket == env) on confirm and view
4. Conditional `updateMany` (status ≠ UPLOADED) → double-confirm / overwrite → 409
5. Post-confirm `HeadObjectCommand`: object exists, `ContentLength` from server, Content-Type matches stored mime
6. Post-update row audit: status UPLOADED, key regex, bucket match, size == HEAD → else mark FAILED, 500
7. Soft delete → verify `deletedAt`, best-effort `DeleteObjectCommand`
8. Audio-url reads refuse deleted / non-UPLOADED / bad key

## Files touched
**Backend**
- `backend/prisma/schema.prisma`, migration, `backend/prisma/seed.ts`
- `backend/src/service/upload.service.ts` (extend)
- `backend/src/service/question.service.ts` (strip promptText, select audio fields)
- `backend/src/controllers/question.controller.ts`, `backend/src/routes/question.routes.ts`

**Frontend**
- `frontend/lib/question-audio-api.ts` (new; reuse `uploadToR2`)
- `frontend/types/test.ts`, `types/admin.ts`, `types/examiner.ts`, `lib/dashboard-api.ts`, `lib/admin-api.ts`
- `frontend/app/admin/questions/page.tsx` (upload + confirm UI, save gated on UPLOADED)
- `frontend/components/test/PromptDisplay.tsx`, `frontend/app/test/[testId]/page.tsx` (audio player, autoplay, replay)
- `frontend/components/examiner/VideoReviewer.tsx`, `ScoringPanel.tsx`, `frontend/app/results/[submissionId]/page.tsx`

## Execution iterations

### Iteration 1 — Schema
- [x] Drop `promptText` from `Question` in `schema.prisma`
- [x] Add `audioStorageKey`, `audioMimeType`, `audioSizeBytes`, `audioUploadStatus` to `Question`
- [x] `prisma migrate dev --name question_audio_prompt` + `prisma generate`
- [x] Remove `promptText` usage from `seed.ts`
- **Check:** generated client compiles; `Question` model has audio fields, `Task` untouched — **PASSED 2026-08-04** (`tsc --noEmit` clean; `Question.ts` 0 `promptText`, audio fields present; `Task.ts` retains `promptText`)

### Iteration 2 — Upload service (`upload.service.ts`)
- [x] `generateQuestionAudioKey(questionId)` + `AUDIO_KEY_RE`
- [x] `createQuestionAudioPresignedUpload(questionId, mimeType)` — exists + not-deleted check, conditional `updateMany` (status ≠ UPLOADED)
- [x] `confirmQuestionAudioUpload(questionId)` — HEAD-object audit + post-update row audit
- [x] `createQuestionAudioViewUrl(questionId)` — deleted / non-UPLOADED / bad key refusal
- [x] `deleteQuestion` cleanup: soft delete then best-effort `DeleteObjectCommand`
- **Check:** confirm-before-upload fails; double-confirm → 409; tampered key rejected — **PASSED 2026-08-04** (`scripts/check-question-audio.ts`, all 26 checks green; fixed missing `import "dotenv/config"` so the script loads env)

### Iteration 3 — Controllers + routes + service input types
- [x] `question.service.ts`: strip `promptText` from `CreateQuestionInput`/`UpdateQuestionInput`; `retrieveQuestions` selects audio fields
- [x] `question.controller.ts`: strip `promptText` validation; add `createQuestionAudioPresignedUrl`, `confirmQuestionAudioUpload`, `getQuestionAudioUrl`
- [x] `question.routes.ts`: `POST /audio/presigned-url` (ADMIN), `POST /audio/confirm` (ADMIN), `GET /:id/audio-url` (authed)
- **Check:** all writes ADMIN-only; UUID + mime allowlist enforced — **PASSED 2026-08-04** (landed in commit `285056e`; `tsc --noEmit` clean; remaining `promptText` refs are Task-only, per decision)

### Iteration 4 — Security negative tests
- [x] Non-admin write → 403
- [x] Video mimeType → 400
- [x] Confirm-before-upload → 500/FAILED
- [x] Double-confirm → 409
- [x] Tampered storageKey → rejected
- [x] Deleted question audio-url → 404
- **Check:** every case returns expected status, row marked FAILED where required — **PASSED 2026-08-04** (`scripts/check-question-audio-http.ts`, boots server on free port, 12 HTTP checks green)

### Iteration 5 — Frontend API + types
- [x] `lib/question-audio-api.ts` (new): presigned-url, confirm, get-url; reuse `uploadToR2`
- [x] `types/test.ts`, `types/admin.ts`, `types/examiner.ts`, `lib/dashboard-api.ts`: Question drops `promptText`, adds audio fields
- [x] `lib/admin-api.ts`: create/update payloads drop `promptText`
- [x] New `components/QuestionAudioPlayer.tsx` shared audio player (bridge for Iterations 7–8)
- [x] Admin page create/edit forms + list drop `promptText`; validation requires order only (upload UI deferred to Iteration 6)
- **Check:** `tsc` clean; no remaining `promptText` refs on Question types — **PASSED 2026-08-04** (frontend + backend `tsc --noEmit` clean; remaining `promptText` refs are Task-only; test page `Prompt.audioUrl` bridge set to `null` until Iteration 7 fetches presigned URLs)

### Iteration 6 — Admin UI
- [x] `app/admin/questions/page.tsx`: textarea → file input + progress + upload/confirm
- [x] Save disabled until audio `UPLOADED`
- [x] Tasks section unchanged (text)
- **Check:** full admin flow: create → upload → confirm → status chip shows UPLOADED — **PASSED 2026-08-04** (`AudioUploadButton` file input → presigned PUT → R2 → confirm; `AudioUploadBadge` status chips in list + edit form; Save gated on UPLOADED; create auto-opens edit form for upload)

### Iteration 7 — Student test page
- [ ] `PromptDisplay.tsx`: `text` → audio player (autoplay + replay)
- [ ] `app/test/[testId]/page.tsx`: fetch audio URL per question, autoplay on start
- **Check:** question audio plays, replay works, tasks render as text list

### Iteration 8 — Examiner + results pages
- [ ] `VideoReviewer.tsx`, `ScoringPanel.tsx`: question text → audio player
- [ ] `app/results/[submissionId]/page.tsx`: question text → audio player
- **Check:** examiner + results pages play audio; task text unchanged

### Iteration 9 — Full verify
- [ ] Backend `tsc` clean
- [ ] Frontend lint + `tsc` clean
- [ ] Manual flow: create → presigned-url → PUT → confirm → audio-url plays
- **Check:** all iterations' checks pass; `promptText` gone from Question everywhere
