# FluentCheck UI Redesign — Unified shadcn + "Examination Room" Brand

> **Status:** Approved plan (2026-08-03)
> **Scope:** Full app — landing, auth, dashboard, results, test session, admin, examiner
> **Direction:** Keep the "Examination Room" brand; rebuild every surface on the
> shadcn component system; remove the leftover generic (zinc / blue-gradient /
> emerald-pill) styling.
> **Version:** 1.0.0

---

## 1. Context & Diagnosis

The app currently ships **two visual languages side by side**:

- **The landing page** (`app/page.tsx`) — the distinctive "Examination Room"
  identity: `paper`/`ink`/`rule`/`signal` palette, Newsreader serif display,
  mono uppercase micro-labels, ruled fields, status `Stamp`s, and the 9-cell
  `BandGauge`.
- **Every authenticated surface** (login, signup, dashboard, results, test,
  admin, examiner) — the older generic look: `bg-zinc-50` + `bg-white` +
  `rounded-xl` cards, a blue→indigo gradient brand panel, and ad-hoc
  `bg-emerald-50` / `bg-red-50` / `bg-amber-50` status pills.

That inconsistency reads as "dated" and unfinished.

**Head-start:** shadcn is already 90% wired. `components.json` (style
`base-nova`), `tw-animate-css`, `lib/utils.ts` (`cn`), and the entire
`--color-*` contract in `app/globals.css` are in place. The brand palette is
already mapped onto shadcn's `--background` / `--primary` / `--destructive` /
`--radius` tokens, so installing real shadcn components renders in brand colors
with no extra theming work.

---

## 2. Design Principles

1. **One system.** Every page is composed from the same shadcn primitives,
   tinted by the brand tokens. No parallel hand-rolled replacements.
2. **The identity is the artifact, not the default.** Keep `BandGauge`,
   `Stamp`, and `Wordmark` — shadcn has no equivalent, and they are the
   memorable part of the product.
3. **Two themes, used deliberately.** The app is `paper`-toned (an exam
   document). The **only** dark place is the test session — the "studio"
   recording room — because that is the one moment the user is on camera.
4. **Flat and ruled, not pill-y.** Small radius (`--radius: 0.375rem`), hairline
   `rule` borders, no heavy shadows. This is what separates the brand from a
   stock shadcn dashboard.
5. **Structure is information.** Numbering (protocol steps), eyebrows, dividers,
   and status language each encode real meaning and stay consistent app-wide.

---

## 3. Thematic Moves That Unify The App

### 3.1 Paper surfaces everywhere

Replace the authenticated surfaces' `bg-zinc-50` / `bg-white` / `rounded-xl` /
`shadow-sm` with:

| Legacy | Brand equivalent |
|---|---|
| `bg-zinc-50` (page) | `bg-paper` |
| `bg-white` (card) | `bg-paper-raised` |
| `border-[var(--border)]` | `border-rule` |
| `rounded-xl` / `rounded-lg` | `rounded-[var(--radius)]` (or `rounded-sm` for controls) |
| `shadow-sm` / `shadow-lg` | remove / `shadow-none` |

The theme contract in `globals.css` already maps `--card` / `--border` etc., so
plain shadcn `Card`/`CardContent`/`Table` will inherit the right values.

### 3.2 Formalized status language

Collapse every hand-rolled status pill into **one** primitive. Two tiers:

- **Operational status** (apply to admin + examiner + results:
  ASSIGNED / IN_PROGRESS / COMPLETED / PAID / PENDING / FAILED …) → shadcn
  `Badge` with re-toned variants.
- **Verdict moments** (CERTIFIED / PASSED / AWAITING / REC …) → the existing
  `Stamp` (bordered mono uppercase pill).

Add Badge tone utilities in `globals.css`:

```css
/* Badge tone variants — applied as data-[tone=...] selectors on shadcn Badge */
[data-tone="verified"] { color: var(--verified); border-color: var(--verified); }
[data-tone="signal"]   { color: var(--signal);  border-color: var(--signal); }
[data-tone="amber"]    { color: #a16207;        border-color: #f59e0b; }
[data-tone="neutral"]  { color: var(--ink-soft); border-color: var(--rule-strong); }
```

### 3.3 Micro-labels as the standard

The brand's mono uppercase eyebrow (already used in `components/ui/Input.tsx`
and the landing page) becomes the standard for:

- table `<th>` rows,
- section eyebrows and card headers,
- card footers ("Marked by the FluentCheck jury"),
- empty states.

Add one shared class if needed:

```css
.mark {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
```

### 3.4 One score surface

Create a reusable score component (used by results + dashboard) that mirrors
the landing page's "specimen report": overall band at `BandGauge` `lg`, then a
per-criteria `dl` of rows (Pronunciation / Fluency / Vocabulary / Grammar) with
`BandGauge` `sm` + mono value.

```tsx
// components/results/ScoreCard.tsx (new)
export function ScoreCard({
  score, feedback, pending, className,
}: { score: ScoreBreakdown; feedback?: Feedback; pending?: boolean; className?: string })
```

`pending` renders an `Alert` ("Your recording is being reviewed by our expert
jury. Check back soon.") instead of scores.

### 3.5 Dark = the studio, only on camera

The test session (`app/test/[testId]/page.tsx`), `WebcamPreview`, and its
loading / error / completion states are the **only** places that use the dark
`--studio*` tokens. The `.dark` block in `globals.css` already maps the full
contract to `studio` — the test page should use the same values:

| Legacy (test page) | Studio equivalent |
|---|---|
| `bg-zinc-950` | `bg-studio` |
| `bg-zinc-900` / `bg-zinc-900/50` | `bg-studio-panel` |
| `border-zinc-800` | `border-studio-rule` |
| `text-white` | `text-studio-text` |
| `text-zinc-400` / `text-zinc-500` | `text-studio-text/70` |
| `text-blue-500` / `bg-blue-500` | `text-studio-text` / `bg-signal` |
| `bg-emerald-500` / `text-emerald-500` | `bg-verified` / `text-verified` |
| `bg-red-500` / `text-red-400` | `bg-signal` / `text-signal` |
| `bg-amber-500` / `text-amber-400` | `text-amber` accents (see 3.2) |

No dark-mode toggle site-wide. The light app + dark test room is the
intentional, coherent story.

---

## 4. shadcn Component Inventory

Install with (project is already initialized — this only adds component files):

```bash
npx shadcn@latest add \
  button card input label badge separator skeleton \
  progress tooltip avatar alert alert-dialog dialog \
  sheet dropdown-menu breadcrumb accordion tabs table select \
  sonner pagination
```

Rationale:

| Component | Replaces / used by |
|---|---|
| `button` | custom `components/ui/Button.tsx` |
| `input` `label` | custom `components/ui/Input.tsx` |
| `card` `separator` | dashboard, results, admin cards |
| `badge` | status pills across admin/examiner/results |
| `skeleton` | `dashboard/loading.tsx`, buffers |
| `progress` | upload progress (test page, R2 upload) |
| `tooltip` `avatar` | user menus, examiner identity |
| `alert` | inline errors / "being reviewed" / offline banner |
| `dialog` `alert-dialog` | custom `Modal`, `CameraMicPermissionModal`, admin confirms |
| `sheet` | mobile nav (admin/examiner), test progress drawer |
| `dropdown-menu` | account menu (header), row actions |
| `breadcrumb` | admin / examiner / results bread trail |
| `accordion` `tabs` | admin questions grouped by category; results filter tabs |
| `table` `select` | admin tables + native `<select>` role controls |
| `sonner` | toasts: "Profile saved", payment success, upload errors |
| `pagination` | admin pagination (replace button pair) |

No new non-shadcn dependencies are introduced; existing forms stay manual
state + zod (deliberate — avoids pulling react-hook-form).

---

## 5. Component Consolidation

### Replace
- **`components/ui/Button.tsx` → shadcn `button`** (`@/components/ui/button`).
  Map variants:
  | current | mapping |
  |---|---|
  | `primary` | `default` (primary token = ink) |
  | `secondary` | `secondary` (verified) |
  | `invert` | light text on dark — add a local `variant` override or use `variant="outline"` on `bg-paper` |
  | `outline` | `outline` |
  | `ghost` | `ghost` |
  | `danger` | `destructive` |
  Link buttons via `asChild` + `next/link`.
- **`components/ui/Input.tsx` → shadcn `input` + `label`.** Port the mono
  micro-label / error / helper wrapper into a thin presentational layer used by
  auth + admin forms (keep file name `FormField` if reused, otherwise inline).
- **`components/ui/Spinner.tsx` → lucide `Loader2` + `animate-spin`.** Update
  all call sites (`aria-busy` on buttons retained).

### Delete (after all call sites migrate)
- `components/ui/Button.tsx`
- `components/ui/Input.tsx`
- `components/ui/Spinner.tsx`

### Keep
- `components/ui/BandGauge.tsx` — the 9-cell band artifact.
- `components/ui/Stamp.tsx` — verdict/certification stamp.
- `components/layout/Wordmark.tsx` — the brand mark.
- `lib/cn` re-exports `cn` from `lib/utils` (canonical source).

---

## 6. Per-Page Migration Matrix

| Page | Components in play | Key changes |
|---|---|---|
| `login`, `signup` | `Card`, `Button`, `Input`, `Label`, `Alert`, `Stamp` | Drop `bg-zinc-50` + blue→indigo gradient brand panel → `bg-paper` split layout (marketing side reuses the specimen/BandGauge motif); ruled inputs; `rounded-xl`→`--radius`; keep auth logic + skip-link |
| `dashboard` | `Card`, `Badge`, `Button`, `Avatar`, `Skeleton`, `Progress`, `BandGauge`, `Alert` | `bg-zinc-50`→`bg-paper`; brand stat cards; "Start your assessment" CTA; score surface when a score exists; empty state in brand voice; role views (EXAMINER/ADMIN) unchanged in logic |
| `results/[submissionId]` | `Card`, `Badge`, `Button`, `Separator`, `Progress`, `BandGauge`, `Alert`, `Sonner` | `bg-zinc-50`→paper; score hero via `ScoreCard`; status pills→`Badge`; payment flow→`Dialog`/`Sonner`; video player on paper-raised |
| `test/[testId]` | `Button`, `Progress`, `Stamp`, `Sheet` (progress drawer) | Re-theme all zinc/blue/emerald/amber → `--studio*` + `--signal`; REC state via `Stamp`; keep full-screen (no header) + state machine untouched |
| `admin/layout` + `admin/*` | `Sheet`, `Breadcrumb`, `Card`, `Table`, `Select`, `Badge`, `Dialog`, `AlertDialog`, `Button`, `Input` | `bg-zinc-50`→paper; `rounded-xl`→brand; `StatusBadge` tone map→shadcn Badge; native `<select>`→`Select`; `<table>`→`Table`; keep role gate + `users`/`submissions`/`questions` logic intact |
| `examiner/assignments/[id]` | `Breadcrumb`, `Card`, `Badge`, `Button`, `Progress`, `Table` | Same re-theme; status tones→`Badge`; keep scoring/assignment logic intact |

**Do not change:** the test session state machine
(`useRecording`, `useCountdown`, `useMediaDevices`, upload/retry flow), the
API layer, auth contexts, or any backend contract. This is a presentation-layer
redesign.

---

## 7. globals.css Cleanup

After all pages migrate:

1. Delete the **"Deprecated aliases"** stopgap block (`--primary-dark`,
   `--danger`, `--warning`) and resolve any straggler references.
2. Add the `[data-tone=...]` Badge utilities and the `.mark` micro-label class.
3. Keep: brand tokens, `@theme inline` mapping, `:focus-visible` ring
   (`--signal`), `prefers-reduced-motion`, form autofill fix, `animate-rise` /
   `gauge-fill` keyframes.
4. Beware selector specificity: prefer single shared utility classes over
   `.section`-style element selectors that collide with component padding.

---

## 8. Implementation Order

1. **Foundation (no UI change yet):** run the `shadcn add …` command; add Badge
   tone + `.mark` utilities; verify `npm run build` passes.
2. **Primitive swap:** migrate custom `Button`/`Input`/`Spinner` call sites to
   shadcn equivalents, then delete the three files. Build-verify.
3. **Auth:** login + signup (paper split layout, brand panel, ruled inputs).
4. **App shell + dashboard + results:** paper surfaces, `ScoreCard`, `Sonner`
   toasts, empty states.
5. **Test session:** studio re-theme (the single dark "on-camera" moment).
6. **Admin + examiner:** tables, selects, dialogs, badges, sheet nav.
7. **Polish/QA:** visual pass + screenshots; a11y (focus rings, `aria-live`,
   skip links); responsive down to mobile; `prefers-reduced-motion`; final
   `npm run build` + `npm run lint`.

---

## 9. Definition of Done

- [ ] One shadcn component system across all pages.
- [ ] No `bg-zinc-*`, blue/indigo gradients, or ad-hoc `bg-*-50` pills remain
      in `app/` or `components/`.
- [ ] `BandGauge`, `Stamp`, `Wordmark` retained; custom `Button`/`Input`/
      `Spinner` removed.
- [ ] Test session uses only `--studio*`/`--signal`; every other page uses
      paper/ink/rule.
- [ ] `npm run build` and `npm run lint` clean.
- [ ] `FRONTEND_ARCHITECTURE.md` §8/§9 updated to the new component inventory.

---

## 10. Open / Explicitly Deferred

- **Dark mode toggle:** not included (light app + dark test room is the
  deliberate read; tokens are already mapped if this changes later).
- **react-hook-form / shadcn `Form`:** not adopted; forms remain manual state
  + zod to avoid a new dependency.
- **Marketing page:** already on-brand; only touched if a drift is found.
