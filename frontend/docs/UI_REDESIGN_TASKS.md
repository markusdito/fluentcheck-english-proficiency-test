# FluentCheck UI Redesign — Task Tracker

> **Plan:** `frontend/docs/UI_REDESIGN.md` v1.0.0 (approved 2026-08-03)
> **Tracker created:** 2026-08-03
> **Status legend:** `[ ]` pending · `[x]` done · `[~]` in progress
> **Decisions:** Strict shadcn migration (delete custom `Button`/`Input`/`Spinner`) ·
> full shared app shell (consolidated `Header`, `dropdown-menu`, `breadcrumb`, `sheet`,
> `Sonner` toasts).
> **Result note:** results API exposes a submission-level band + per-answer 0–100
> scores (no 4-skill breakdown) — the §3.4 `ScoreCard` is implemented against real
> fields (BandGauge hero + per-question rows).

---

## Phase 1 — Foundation

- [x] Run `npx shadcn@latest add button card input label badge separator skeleton
      progress tooltip avatar alert alert-dialog dialog sheet dropdown-menu
      breadcrumb accordion tabs table select sonner pagination`
- [x] `npm run build` passes (baseline; lint has pre-existing React-hooks-version errors in protected hooks — noted §Phase 7)
- [x] `globals.css`: add `[data-tone=...]` Badge utilities + `.mark` micro-label class
- [x] Keep "Deprecated aliases" block until Phase 7

## Phase 2 — Primitive swap

- [x] shadcn `button`: brand size map, `invert` variant, `loading` via Loader2, default `type="button"`
- [x] New `FormField` wrapper: shadcn `input` + mono eyebrow label + error/helper
      + `ruled-field` styling (replaces custom `Input` call sites)
- [x] Replace `Spinner` call sites with lucide `Loader2` + `animate-spin`
- [x] Migrate `app/page.tsx` (landing) Button call sites (asChild via `render` + `Link`) to shadcn
- [x] Delete `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/ui/Spinner.tsx`
- [x] `npm run build` passes

## Phase 3 — Auth

- [x] `app/login/page.tsx`: paper split layout — brand/specimen panel +
      ruled form card; keep auth logic + skip link
- [x] `app/signup/page.tsx`: same treatment
- [x] `LoginForm` / `SignupForm`: shadcn Button + FormField + Alert
- [x] `npm run build` passes

## Phase 4 — App shell + Dashboard + Results

- [x] Shared `Header` + `AccountMenu` (avatar dropdown) — dashboard + results adopted
      (admin/examiner adoption lands in Phase 6)
- [x] `Sonner` `<Toaster/>` mounted in root layout (light theme, no next-themes)
- [x] Toast wiring: payment submitted/confirmed/cancelled on results
- [x] `app/dashboard/page.tsx`: paper surfaces, stat cards (mono eyebrow),
      ink CTA panel (no gradient), badge/Stamp statuses, brand empty state,
      `loading.tsx` skeleton
- [x] New `components/results/ScoreCard.tsx`: BandGauge hero (submission band)
      + per-question 0-100 hairline rows; pending state alert
- [x] `app/results/[submissionId]/page.tsx`: paper re-theme, Breadcrumb,
      badges, pay block on paper-raised + Sonner, video cards re-themed
- [x] `npm run build` passes

## Phase 5 — Test session (studio dark)

- [x] `app/test/[testId]/layout.tsx`: `bg-studio`
- [x] `app/test/[testId]/page.tsx`: `--studio*`/`--signal`/`--verified` re-theme,
      invert (paper) primary buttons, hairline progress, REC via `Stamp`; state machine untouched
- [x] `WebcamPreview`, `PromptDisplay`, `RecordingTimer`: studio re-theme
- [x] `CameraMicPermissionModal`: paper theme with studio camera preview
      (dashboard-facing — the dark "on camera" moment stays in the test room)
- [x] `npm run build` passes — state machine untouched

## Phase 6 — Admin + Examiner

- [x] `app/admin/layout.tsx`: shared Header, mono underline nav, auto Breadcrumb,
      Sheet mobile nav, paper surface; role gate preserved
- [x] `app/admin/page.tsx` (overview): stat blocks, SubmissionStatus badges, ruled list
- [x] `app/admin/users/page.tsx`: Table, Select, FormField search (Button-pair paging kept)
- [x] `app/admin/submissions/page.tsx`: Table, Badge tones, assign flow + Sonner
- [x] `app/admin/questions/page.tsx`: Tabs per part, AlertDialog retire confirm,
      forms via FormField/Select
- [x] Delete `components/admin/StatusBadge.tsx` (absorbed by `SubmissionStatus`)
- [x] `app/examiner/assignments/[assignmentId]` + `AssignmentList`/`ScoringPanel`/
      `VideoReviewer`: paper re-theme, shared Header/AccountMenu, Badge tones
- [x] `npm run build` passes

## Phase 7 — Polish / QA

- [x] Remove "Deprecated aliases" block and resolve straggler references
- [x] Sweep: no zinc, gradients, `bg-*-50` pills, old `var(--*)` refs, or stray
      `rounded-xl`/shadows remain (VideoPlayer progress branded signal/hairline)
- [x] a11y: focus rings (`--signal`), skip links on dashboard/results/auth,
      aria-live toasts; responsive passes; reduced-motion respected
- [x] Final `npm run build` clean; lint 13 problems vs 15 baseline (11 errors are
      pre-existing React-hooks-version rules in protected hooks / data-fetch effects —
      outside the presentation-layer scope)
- [x] Update `frontend/docs/FRONTEND_ARCHITECTURE.md` §8/§9 to new inventory
- [x] UI_REDESIGN.md §9 Definition of Done fully ticked

---

## Definition of Done check (UI_REDESIGN §9)

- [x] One shadcn component system across all pages
- [x] No `bg-zinc-*`, blue/indigo gradients, or ad-hoc `bg-*-50` pills remain
- [x] `BandGauge`, `Stamp`, `Wordmark` retained; custom `Button`/`Input`/`Spinner` removed
- [x] Test session uses only `--studio*`/`--signal`; every other page uses paper/ink/rule
- [x] `npm run build` clean; `npm run lint` 13 problems (vs 15 baseline, all pre-existing)
- [x] `FRONTEND_ARCHITECTURE.md` §8/§9 updated
