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
- [ ] Drop `promptText` from `Question` in `schema.prisma`
- [ ] Add `audioStorageKey`, `audioMimeType`, `audioSizeBytes`, `audioUploadStatus` to `Question`
- [ ] `prisma migrate dev --name question_audio_prompt` + `prisma generate`
- [ ] Remove `promptText` usage from `seed.ts`
- **Check:** generated client compiles; `Question` model has audio fields, `Task` untouched

### Iteration 2 — Upload service (`upload.service.ts`)
- [ ] `generateQuestionAudioKey(questionId)` + `AUDIO_KEY_RE`
- [ ] `createQuestionAudioPresignedUpload(questionId, mimeType)` — exists + not-deleted check, conditional `updateMany` (status ≠ UPLOADED)
- [ ] `confirmQuestionAudioUpload(questionId)` — HEAD-object audit + post-update row audit
- [ ] `createQuestionAudioViewUrl(questionId)` — deleted / non-UPLOADED / bad key refusal
- [ ] `deleteQuestion` cleanup: soft delete then best-effort `DeleteObjectCommand`
- **Check:** confirm-before-upload fails; double-confirm → 409; tampered key rejected

### Iteration 3 — Controllers + routes + service input types
- [ ] `question.service.ts`: strip `promptText` from `CreateQuestionInput`/`UpdateQuestionInput`; `retrieveQuestions` selects audio fields
- [ ] `question.controller.ts`: strip `promptText` validation; add `createQuestionAudioPresignedUrl`, `confirmQuestionAudioUpload`, `getQuestionAudioUrl`
- [ ] `question.routes.ts`: `POST /audio/presigned-url` (ADMIN), `POST /audio/confirm` (ADMIN), `GET /:id/audio-url` (authed)
- **Check:** all writes ADMIN-only; UUID + mime allowlist enforced

### Iteration 4 — Security negative tests
- [ ] Non-admin write → 403
- [ ] Video mimeType → 400
- [ ] Confirm-before-upload → 500/FAILED
- [ ] Double-confirm → 409
- [ ] Tampered storageKey → rejected
- [ ] Deleted question audio-url → 404
- **Check:** every case returns expected status, row marked FAILED where required

### Iteration 5 — Frontend API + types
- [ ] `lib/question-audio-api.ts` (new): presigned-url, confirm, get-url; reuse `uploadToR2`
- [ ] `types/test.ts`, `types/admin.ts`, `types/examiner.ts`, `lib/dashboard-api.ts`: Question drops `promptText`, adds audio fields
- [ ] `lib/admin-api.ts`: create/update payloads drop `promptText`
- **Check:** `tsc` clean; no remaining `promptText` refs on Question types

### Iteration 6 — Admin UI
- [ ] `app/admin/questions/page.tsx`: textarea → file input + progress + upload/confirm
- [ ] Save disabled until audio `UPLOADED`
- [ ] Tasks section unchanged (text)
- **Check:** full admin flow: create → upload → confirm → status chip shows UPLOADED

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
