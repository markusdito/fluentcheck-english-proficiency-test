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

- [ ] Shared `components/layout/Header.tsx` used by dashboard/results/admin/examiner
      (Wordmark + nav + account dropdown-menu)
- [ ] `Sonner` `<Toaster/>` mounted in root/provider layout
- [ ] Toast wiring: payment result, profile/actions feedback
- [ ] `app/dashboard/page.tsx`: paper surfaces, stat cards (mono eyebrow),
      "Start your assessment" CTA (no gradient), badge statuses, brand empty state,
      candidate `loading.tsx` skeleton
- [ ] New `components/results/ScoreCard.tsx`: BandGauge hero (submission band)
      + per-question rows
- [ ] `app/results/[submissionId]/page.tsx`: paper re-theme, badges, pay block via
      Card/Dialog + Sonner, video cards on paper-raised
- [ ] `npm run build` passes

## Phase 5 — Test session (studio dark)

- [ ] `app/test/[testId]/layout.tsx`: `bg-studio`
- [ ] `app/test/[testId]/page.tsx`: `--studio*`/`--signal`/`--verified` re-theme;
      REC via `Stamp`; Loader2 spinners; full-screen preserved
- [ ] `WebcamPreview`, `PromptDisplay`, `RecordingTimer`: studio re-theme
- [ ] `CameraMicPermissionModal`: studio-compatible theme
- [ ] `npm run build` passes — state machine untouched

## Phase 6 — Admin + Examiner

- [ ] `app/admin/layout.tsx`: shared Header, Breadcrumb, Sheet mobile nav, paper
      surface; role gate preserved
- [ ] `app/admin/page.tsx` (overview): Card stat blocks, StatusBadge → shadcn Badge
- [ ] `app/admin/users/page.tsx`: Table, Select, Pagination, FormField search
- [ ] `app/admin/submissions/page.tsx`: Table, Badge tones, assign flow
- [ ] `app/admin/questions/page.tsx`: Card, Tabs/Accordion, Dialog/AlertDialog
      confirms; forms via FormField
- [ ] Delete/absorb `components/admin/StatusBadge.tsx`
- [ ] `app/examiner/assignments/[assignmentId]` + `AssignmentList`/`ScoringPanel`/
      `VideoReviewer`: re-theme + Badge tones
- [ ] `npm run build` passes

## Phase 7 — Polish / QA

- [ ] Remove "Deprecated aliases" block (`--primary-dark`, `--danger`, `--warning`)
      and resolve straggler references
- [ ] Sweep `app/` + `components/` for `bg-zinc-*`, blue/indigo gradients,
      `bg-*-50` pills, `rounded-xl`/`shadow-*`, `var(--<old>)` leftovers
- [ ] a11y: focus rings, aria-live, skip links; responsive to mobile;
      `prefers-reduced-motion` respected
- [ ] Final `npm run build` + `npm run lint` clean
- [ ] Update `frontend/docs/FRONTEND_ARCHITECTURE.md` §8/§9 to new inventory
- [ ] UI_REDESIGN.md §9 Definition of Done fully ticked

---

## Definition of Done check (UI_REDESIGN §9)

- [ ] One shadcn component system across all pages
- [ ] No `bg-zinc-*`, blue/indigo gradients, or ad-hoc `bg-*-50` pills remain
- [ ] `BandGauge`, `Stamp`, `Wordmark` retained; custom `Button`/`Input`/`Spinner` removed
- [ ] Test session uses only `--studio*`/`--signal`; every other page uses paper/ink/rule
- [ ] `npm run build` and `npm run lint` clean
- [ ] `FRONTEND_ARCHITECTURE.md` §8/§9 updated
