# FluentCheck Frontend — Task List

This document tracks all implementation tasks for the FluentCheck frontend, organized by priority and dependency order.

---

## Phase 1: Foundation (Setup & Core Infrastructure)

- [ ] **1.1 — Update global styles** (`globals.css`)
  - Add brand color CSS variables
  - Configure Tailwind theme (primary, accent, danger, etc.)
  - Set up dark mode support

- [ ] **1.2 — Create reusable UI components**
  - [ ] `Button.tsx` — variants: primary, secondary, outline, ghost, danger; sizes: sm, md, lg; loading state
  - [ ] `Card.tsx` — flexible card wrapper with optional padding
  - [ ] `Input.tsx` — form input with label, error state, icon support
  - [ ] `Spinner.tsx` — CSS-only loading spinner
  - [ ] `Badge.tsx` — status/score badges (success, warning, error, info, default)
  - [ ] `ProgressBar.tsx` — animated progress indicator
  - [ ] `Modal.tsx` — dialog with backdrop, ESC/click-to-close, focus trap

- [ ] **1.3 — Define TypeScript types** (`types/`)
  - [ ] `types/api.ts` — ApiResponse<T>, ApiError class
  - [ ] `types/auth.ts` — User, LoginRequest, SignupRequest, AuthResponse
  - [ ] `types/test.ts` — Prompt, TestSection, TestSession, Recording
  - [ ] `types/results.ts` — ScoreBreakdown, Feedback, TestResult

- [ ] **1.4 — Build API layer** (`lib/`)
  - [ ] `lib/api.ts` — Base fetch wrapper with JWT auto-attach, 401 handling, error parsing
  - [ ] `lib/auth-api.ts` — login, signup, getMe, updateProfile, changePassword
  - [ ] `lib/test-api.ts` — getTests, getTestById, startSession, uploadRecording
  - [ ] `lib/results-api.ts` — getResults, getResultById
  - [ ] `lib/user-api.ts` — profile CRUD
  - [ ] `lib/media-recorder.ts` — MediaRecorder abstraction utilities

- [ ] **1.5 — Create Auth context & hook**
  - [ ] `contexts/AuthContext.tsx` — user, token, isLoading, isAuthenticated; login(), signup(), logout()
  - [ ] `hooks/useAuth.ts` — convenience wrapper

- [ ] **1.6 — Create layout components**
  - [ ] `components/layout/Header.tsx` — responsive nav with auth-aware menu
  - [ ] `components/layout/Footer.tsx` — simple footer

- [ ] **1.7 — Update root layout** (`app/layout.tsx`)
  - Wrap with AuthProvider
  - Include Header/Footer
  - Set proper metadata

---

## Phase 2: Pages — Landing & Auth

- [ ] **2.1 — Landing page** (`app/page.tsx`)
  - Hero section with app name, tagline, CTA buttons
  - Features overview (4 feature cards)
  - Clean, professional design — no Next.js boilerplate

- [ ] **2.2 — Login page** (`app/login/page.tsx`)
  - Centered card with email + password form
  - Loading state, error display
  - Link to signup
  - Redirect to dashboard on success

- [ ] **2.3 — Signup page** (`app/signup/page.tsx`)
  - Name, email, password, confirm password, optional target score
  - Inline validation (email format, password min 8, passwords match)
  - Auto-login and redirect to hardware check on success

---

## Phase 3: Dashboard

- [ ] **3.1 — Dashboard page** (`app/dashboard/page.tsx`)
  - Protected route (redirect if not authenticated)
  - Welcome message with user name
  - Stats summary card (total tests, avg score, best score)
  - "Start New Test" CTA → `/test/hardware-check`

- [ ] **3.2 — Dashboard components**
  - [ ] `components/dashboard/StatsSummary.tsx`
  - [ ] `components/dashboard/TestHistoryList.tsx`
  - [ ] `components/dashboard/TestHistoryCard.tsx`

- [ ] **3.3 — Loading state** (`app/dashboard/loading.tsx`)
  - Skeleton UI while fetching data

---

## Phase 4: Hardware Check

- [ ] **4.1 — Create hooks**
  - [ ] `hooks/useMediaDevices.ts` — webcam/mic permission & stream management
  - [ ] `hooks/useCountdown.ts` — generic countdown timer

- [ ] **4.2 — Hardware check page** (`app/test/hardware-check/page.tsx`)
  - Real-time webcam preview
  - Mic level indicator (AnalyserNode)
  - Device status checks (webcam, mic, permissions)
  - "Continue to Test" button (enabled only when all pass)
  - Edge cases: no devices, permission denied with instructions

- [ ] **4.3 — Hardware check components**
  - [ ] `components/hardware/DeviceCheckPanel.tsx`

---

## Phase 5: Test Session

- [ ] **5.1 — Create Test context & hooks**
  - [ ] `contexts/TestContext.tsx` — active test session state machine
  - [ ] `hooks/useRecording.ts` — MediaRecorder state machine wrapper

- [ ] **5.2 — Test session page** (`app/test/[testId]/page.tsx`)
  - Full state machine: INTRODUCTION → SECTION_START → PREP → RECORDING → UPLOAD → COMPLETION
  - Timer integration (preparation + recording countdown)
  - Recording controls (start, stop, auto-stop at max duration)
  - Upload with progress, retry on failure (max 3 attempts, exponential backoff)
  - Test completion summary

- [ ] **5.3 — Test session layout** (`app/test/[testId]/layout.tsx`)
  - Full-screen layout, no navigation header

- [ ] **5.4 — Test components**
  - [ ] `components/test/PromptDisplay.tsx`
  - [ ] `components/test/PrepTimer.tsx`
  - [ ] `components/test/WebcamPreview.tsx`
  - [ ] `components/test/RecordingController.tsx`
  - [ ] `components/test/RecordingTimer.tsx`
  - [ ] `components/test/SectionNavigator.tsx`
  - [ ] `components/test/TestCompletionScreen.tsx`

---

## Phase 6: Results

- [ ] **6.1 — Results list page** (`app/results/page.tsx`)
  - Protected route
  - List of completed tests with score previews
  - Filter/sort options (date, score, status)
  - Click to navigate to detail

- [ ] **6.2 — Results detail page** (`app/results/[resultId]/page.tsx`)
  - Overall score display (e.g., "7.5 / 9.0")
  - Score breakdown: pronunciation, fluency, vocabulary, grammar
  - Pure CSS/SVG bar chart visualization
  - Detailed written feedback per category
  - Overall feedback section

- [ ] **6.3 — Results components**
  - [ ] `components/results/ResultsListCard.tsx`
  - [ ] `components/results/ScoreBreakdown.tsx`
  - [ ] `components/results/FeedbackSection.tsx`

---

## Phase 7: Profile

- [ ] **7.1 — Profile page** (`app/profile/page.tsx`)
  - User info display/edit (name, email read-only, target score)
  - Change password form (current, new, confirm)
  - Account statistics (total tests, join date)
  - Save with confirmation

---

## Phase 8: Polish & Edge Cases

- [ ] **8.1 — Error handling**
  - Network offline detection with banner
  - Global API error handling with toast/snackbar
  - Empty states for all lists

- [ ] **8.2 — Responsive design**
  - Mobile-first refinement across all pages
  - Touch-friendly controls (min 44px tap targets)
  - Test recording UI optimized for mobile

- [ ] **8.3 — Accessibility**
  - Keyboard navigation for all interactive elements
  - Aria labels and live regions for dynamic content
  - Skip-to-content link
  - Screen reader announcements for recording status

---

## Progress Summary

| Phase | Total Tasks | Completed |
|-------|-------------|-----------|
| 1. Foundation | ~25 | 0 |
| 2. Landing & Auth | 3 | 0 |
| 3. Dashboard | 4 | 0 |
| 4. Hardware Check | 3 | 0 |
| 5. Test Session | 10 | 0 |
| 6. Results | 5 | 0 |
| 7. Profile | 1 | 0 |
| 8. Polish | 3 | 0 |
| **Total** | **~54** | **0** |