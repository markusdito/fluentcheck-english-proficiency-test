---
name: fluentcheck-frontend
description: >-
  Builds and tests the FluentCheck English assessment UI — pages, components,
  recording flows, API integration, responsive design, accessibility, and
  hardware permission handling with real-time mic visualization.
  Use when users ask about "frontend", "Next.js", "React component",
  "login page", "dashboard", "test session", "recording flow",
  "hardware check", "mic level", "Tailwind CSS", "useMediaDevices",
  "MediaRecorder", "AuthContext", "TestContext", or any frontend feature.
---

# FluentCheck Frontend — Complete Development Skill

Comprehensive guide for building, testing, and maintaining the FluentCheck English proficiency assessment frontend. This skill covers every page, component, hook, API integration, and edge case in the application.

FluentCheck is an English proficiency assessment platform where users record video responses to speaking prompts and receive expert jury feedback. The frontend is built with Next.js 16 (App Router), React 19, TypeScript, and Tailwind CSS v4.

## Project Knowledge

### Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | Next.js (App Router) | 16.2.6 | Breaking changes from training data — read `node_modules/next/dist/docs/` |
| UI Library | React | 19.2.4 | Server Components + Client Components |
| Language | TypeScript | 5.x | Strict mode, `bundler` module resolution |
| Styling | Tailwind CSS | v4 | PostCSS via `@tailwindcss/postcss` |
| Linting | ESLint | 9.x | `eslint-config-next` with core-web-vitals + TypeScript rules |
| Video Recording | MediaRecorder API | browser-native | `video/webm;codecs=vp9,opus` with fallback |
| HTTP Client | native `fetch` | — | Never use Axios |
| State Management | React Context + local state | — | AuthContext, TestContext |
| Form Validation | Zod | planned | Pre-approved dependency |

### File Structure

```
frontend/
├── app/
│   ├── layout.tsx                 # Root layout — wraps with AuthProvider, includes Header
│   ├── page.tsx                   # Landing/Home page — hero, features, CTAs
│   ├── globals.css                # Global styles — Tailwind import, CSS variables, animations
│   ├── login/
│   │   └── page.tsx               # Login page — centered card, email+password
│   ├── signup/
│   │   └── page.tsx               # Registration page — name, email, password, confirm, targetScore
│   ├── dashboard/
│   │   ├── page.tsx               # Dashboard — stats, test history, "Start New Test" CTA
│   │   └── loading.tsx            # Dashboard loading skeleton
│   ├── test/
│   │   ├── [testId]/
│   │   │   ├── page.tsx           # Active test session — full-screen, no header
│   │   │   └── layout.tsx         # Test layout — omits navigation header
│   │   └── hardware-check/
│   │       └── page.tsx           # Webcam/mic permission check
│   ├── results/
│   │   ├── page.tsx               # All results listing — filter, sort, score previews
│   │   └── [resultId]/
│   │       └── page.tsx           # Individual result detail — score breakdown, feedback
│   └── profile/
│       └── page.tsx               # User profile settings — edit info, change password
├── components/
│   ├── ui/                        # Reusable UI primitives
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── Badge.tsx
│   │   ├── Spinner.tsx
│   │   └── ProgressBar.tsx
│   ├── layout/
│   │   ├── Header.tsx             # Nav bar with auth state
│   │   └── Footer.tsx
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── SignupForm.tsx
│   ├── dashboard/
│   │   ├── TestHistoryList.tsx
│   │   ├── TestHistoryCard.tsx
│   │   └── StatsSummary.tsx
│   ├── test/
│   │   ├── PromptDisplay.tsx
│   │   ├── PrepTimer.tsx
│   │   ├── WebcamPreview.tsx
│   │   ├── RecordingController.tsx
│   │   ├── RecordingTimer.tsx
│   │   ├── SectionNavigator.tsx
│   │   └── TestCompletionScreen.tsx
│   ├── results/
│   │   ├── ScoreBreakdown.tsx
│   │   ├── FeedbackSection.tsx
│   │   └── ResultsListCard.tsx
│   └── hardware/
│       └── DeviceCheckPanel.tsx
├── contexts/
│   ├── AuthContext.tsx            # JWT auth state — login/logout/signup
│   └── TestContext.tsx            # Active test session state
├── lib/
│   ├── api.ts                     # Base fetch wrapper with JWT handling
│   ├── auth-api.ts                # Auth-specific API calls
│   ├── test-api.ts                # Test/session API calls
│   ├── results-api.ts             # Results/feedback API calls
│   ├── user-api.ts                # User profile API calls
│   └── media-recorder.ts          # MediaRecorder abstraction utilities
├── types/
│   ├── auth.ts                    # User, LoginRequest, SignupRequest, AuthResponse
│   ├── test.ts                    # TestSession, TestSection, Prompt, Recording
│   ├── results.ts                 # TestResult, ScoreBreakdown, Feedback
│   └── api.ts                     # Generic ApiResponse<T>, ApiError types
└── hooks/
    ├── useAuth.ts                 # Convenience hook for AuthContext
    ├── useMediaDevices.ts         # Webcam/mic permission & stream management
    ├── useRecording.ts            # MediaRecorder state machine
    └── useCountdown.ts            # Generic countdown timer hook
```

### Tools

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server on http://localhost:3000 |
| `npm run build` | Compile TypeScript via `next build` — must pass before commits |
| `npm run lint` | Run ESLint; add `--fix` to auto-fix errors |

## Standards

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Functions | camelCase | `fetchUserById`, `startRecording` |
| Components | PascalCase | `LoginForm`, `RecordingController` |
| Contexts | PascalCase + `Context` suffix | `AuthContext`, `TestContext` |
| Hooks | camelCase with `use` prefix | `useAuth`, `useCountdown` |
| Constants | UPPER_SNAKE_CASE | `API_URL`, `MAX_RETRIES` |
| Page files | kebab-case | `app/test/hardware-check/page.tsx` |
| Component files | PascalCase | `Button.tsx`, `LoginForm.tsx` |
| Lib/hook files | camelCase | `useAuth.ts`, `api.ts` |

### Code Style

```tsx
"use client";

// ✅ Good — typed props, loading state, error handling
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}

export function Button({ variant = 'primary', size = 'md', loading, children, onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(variantStyles[variant], sizeStyles[size])}
      aria-busy={loading}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
}

// ❌ Bad — no types, no loading/disabled handling, no accessibility
function MyButton(props) {
  return <button onClick={props.onClick}>{props.children}</button>;
}
```

### Next.js 16 Specific Rules

- **Read `node_modules/next/dist/docs/` before using any Next.js API** — this version has breaking changes
- Use `next/link` for navigation, `next/navigation` for `useRouter`, `useSearchParams`, etc.
- Use `"use client"` directive for interactive components; keep static pages as Server Components (no directive)
- Wrap the root layout with `AuthProvider` context

## TypeScript Types

### types/auth.ts

```typescript
export interface User {
  id: string;
  name: string;
  email: string;
  targetScore?: number;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  targetScore?: number;
}

export interface AuthResponse {
  user: User;
  token: string;
}
```

### types/test.ts

```typescript
export interface Prompt {
  id: string;
  text: string;
  prepTime: number;          // seconds
  recordingDuration: number; // seconds
  order: number;
}

export interface TestSection {
  id: string;
  title: string;
  description: string;
  order: number;
  prompts: Prompt[];
}

export interface TestSession {
  id: string;
  testId: string;
  status: 'in_progress' | 'completed' | 'expired';
  currentSection: number;
  currentPrompt: number;
  startedAt: string;
}

export interface Recording {
  id: string;
  promptId: string;
  status: 'pending' | 'uploaded' | 'failed';
  duration: number;
}
```

### types/results.ts

```typescript
export interface ScoreBreakdown {
  pronunciation: number;
  fluency: number;
  vocabulary: number;
  grammar: number;
  overall: number;
}

export interface Feedback {
  pronunciation: string;
  fluency: string;
  vocabulary: string;
  grammar: string;
  overall: string;
}

export interface TestResult {
  id: string;
  testName: string;
  completedAt: string;
  score: ScoreBreakdown;
  feedback: Feedback;
  status: 'pending' | 'graded';
}
```

### types/api.ts

```typescript
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errors?: Record<string, string[]>
  ) {
    super(message);
  }
}
```

## API Layer (`lib/`)

### api.ts — Base Fetch Wrapper

```typescript
// Provides:
// api.get<T>(url, params?)
// api.post<T>(url, body)
// api.put<T>(url, body)
// api.delete<T>(url)
//
// - Automatically reads JWT from AuthContext/localStorage
// - Sets Content-Type: application/json for JSON bodies
// - Does NOT set Content-Type for FormData bodies
// - Throws ApiError on non-2xx responses
// - On 401, calls logout() and redirects to /login
```

### Endpoint Mapping

```
POST   /api/auth/register                          → Signup
POST   /api/auth/login                             → Login
GET    /api/auth/me                                → Get current user
PUT    /api/auth/profile                           → Update profile
PUT    /api/auth/password                          → Change password

GET    /api/tests                                  → List available tests
GET    /api/tests/:testId                          → Get test structure (sections, prompts)

POST   /api/tests/:testId/start                    → Start a new test session
GET    /api/tests/:testId/sessions/:sessionId      → Get session state

POST   /api/sessions/:sessionId/sections/:sectionId/prompts/:promptId/recordings
       → Upload recording (FormData with video blob)

GET    /api/results                                → List user's results
GET    /api/results/:resultId                      → Get result detail with scores/feedback
```

## Contexts

### AuthContext (`contexts/AuthContext.tsx`)

**Stores:**
- `user: User | null`
- `token: string | null`
- `isLoading: boolean`
- `isAuthenticated: boolean`

**Exposes:**
- `login(email: string, password: string): Promise<void>`
- `signup(name: string, email: string, password: string, targetScore?: number): Promise<void>`
- `logout(): void`

**Behavior:**
- On mount: reads token from `localStorage`, validates with `GET /api/auth/me`, sets user or clears
- All subsequent API calls automatically attach `Authorization: Bearer <token>` header
- On 401 responses, auto-logout

### TestContext (`contexts/TestContext.tsx`)

**Tracks:**
- Current section index
- Current prompt index
- Session ID
- Test structure (sections with prompts)

## Hooks

### useAuth (`hooks/useAuth.ts`)

Convenience hook that consumes AuthContext. Returns `{ user, token, isLoading, isAuthenticated, login, signup, logout }`.

### useMediaDevices (`hooks/useMediaDevices.ts`)

Manages `getUserMedia` stream lifecycle.

**Returns:**
```typescript
{
  stream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  videoError: string | null;
  audioError: string | null;
  isLoading: boolean;
  micLevel: number;           // 0–100 real-time mic level
  isMicActive: boolean;       // micLevel > threshold
  requestPermissions: () => Promise<void>;
  stopStream: () => void;
}
```

**Mic level implementation:**
- Uses `AudioContext` + `AnalyserNode` for real-time monitoring
- Reads waveform via `getByteTimeDomainData` (raw time-domain samples, 128 = silence)
- Computes RMS deviation from 128, applies 2.5× sensitivity boost + 0.8 smoothing constant
- Detects device list changes (plug/unplug) via `devicechange` event

### useRecording (`hooks/useRecording.ts`)

MediaRecorder state machine wrapper.

**States:** `idle` → `preparing` → `recording` → `stopped` → `uploading` → `error`

**Returns:**
```typescript
{
  state: 'idle' | 'preparing' | 'recording' | 'stopped' | 'uploading' | 'error';
  blob: Blob | null;
  duration: number;           // seconds
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
}
```

**Details:**
- MIME type: `video/webm;codecs=vp9,opus` (fallback to `video/webm`)
- Records in chunks (timeslice: 1000ms for progress tracking)
- On stop: creates Blob from recorded chunks
- Emits `onChunk` callback for progress monitoring

### useCountdown (`hooks/useCountdown.ts`)

```typescript
useCountdown(initialSeconds: number, onComplete?: () => void)
```

**Returns:**
```typescript
{
  seconds: number;
  isRunning: boolean;
  isComplete: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  formatted: string;          // e.g., "0:45"
}
```

## UI Components (`components/ui/`)

### Button.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger'` | `'primary'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size |
| `loading` | `boolean` | `false` | Show spinner, disable interaction |
| `disabled` | `boolean` | `false` | Disable button |
| `fullWidth` | `boolean` | `false` | Stretch to container width |
| `children` | `React.ReactNode` | — | Button content |
| `onClick` | `() => void` | — | Click handler |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | HTML button type |

**Styling:** `rounded-lg`, `font-medium`, `transition-all`, spinner shown during loading with `aria-busy`

### Card.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `React.ReactNode` | — | Card content |
| `className` | `string` | — | Additional CSS classes |
| `padding` | `boolean` | `true` | Include internal padding |

**Styling:** White background, subtle shadow, `rounded-xl`, border

### Input.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | — | Label text (renders `<label>` for accessibility) |
| `error` | `string` | — | Error message (red border + message below) |
| `helperText` | `string` | — | Helper text below input |
| `type` | `string` | `'text'` | HTML input type |
| `placeholder` | `string` | — | Placeholder text |
| `value` | `string` | — | Controlled value |
| `onChange` | `(value: string) => void` | — | Change handler |
| `required` | `boolean` | `false` | Required indicator |
| `disabled` | `boolean` | `false` | Disable input |
| `icon` | `React.ReactNode` | — | Icon element inside input |

### Modal.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | — | Control visibility |
| `onClose` | `() => void` | — | Close handler |
| `title` | `string` | — | Modal title |
| `children` | `React.ReactNode` | — | Modal content |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Modal width |

**Behavior:** Backdrop click-to-close, ESC key to close, focus trap within modal, animate in/out (opacity + slight scale)

### Badge.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'success' \| 'warning' \| 'error' \| 'info' \| 'default'` | `'default'` | Color scheme |
| `children` | `React.ReactNode` | — | Badge content |

**Usage:** Score display, status indicators (e.g., "Graded", "Pending")

### Spinner.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Spinner size |
| `className` | `string` | — | Additional CSS classes |

**Implementation:** CSS-only spinning animation using Tailwind `animate-spin`

### ProgressBar.tsx

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` (0–100) | — | Progress percentage |
| `variant` | `'primary' \| 'success' \| 'warning'` | `'primary'` | Color scheme |
| `showLabel` | `boolean` | `false` | Show percentage label |
| `className` | `string` | — | Additional CSS classes |

**Styling:** Animated width transition

## Layout Components (`components/layout/`)

### Header.tsx

**If authenticated:**
- Logo, nav links (Dashboard, Results, Profile)
- User avatar/name dropdown with logout

**If not authenticated:**
- Logo, nav links (Home, Login, Signup)

**Responsive:** Hamburger menu on mobile

**Styling:** Sticky top with backdrop blur (`sticky top-0 z-50 backdrop-blur`)

### Footer.tsx

Basic links, copyright info.

## Pages

### 1. Landing Page (`app/page.tsx`)

- Hero section with app name, tagline, and CTA buttons
- Features overview (3–4 feature cards)
- Call-to-action: "Get Started" (if not authenticated) or "Go to Dashboard" (if authenticated)
- Professional, clean design — no Next.js boilerplate
- Footer with basic links

### 2. Login Page (`app/login/page.tsx`)

- Clean centered card layout
- Email + password fields
- Submit button with loading state
- Error display (invalid credentials, server error)
- Link to signup page
- After login, redirect to `/dashboard`
- If already authenticated, redirect to `/dashboard`

### 3. Signup Page (`app/signup/page.tsx`)

- Name, email, password, confirm password, optional target score
- Validation: email format, password min 8 chars, passwords match
- Show validation errors inline
- Submit with loading state
- Link to login page
- On success, auto-login and redirect to `/hardware-check` (first-time flow)

### 4. Dashboard (`app/dashboard/page.tsx`)

- Protected route (redirect to `/login` if not authenticated)
- Welcome message with user's name
- Stats summary card: total tests taken, average score, best score
- "Start New Test" prominent CTA button → navigates to `/test/hardware-check`
- Test history list (paginated, scrollable)
- Each history item shows: date, score badge (if graded) or "Pending" badge, section name
- Loading skeleton state (`loading.tsx`)

### 5. Hardware Check (`app/test/hardware-check/page.tsx`)

- Large webcam preview (real-time from `getUserMedia`)
- Mic level indicator (audio volume visualization using AnalyserNode with animated sound bars)
- Check items with status indicators:
  - ✅ Webcam detected / ❌ No webcam
  - ✅ Microphone detected / ❌ No mic
  - ✅ Permission granted / ❌ Permission denied
- "Retry" button for each failed check
- "Continue to Test" button (enabled only when all checks pass)
- Explanation text about why webcam/mic are needed
- Edge cases: handle no devices, permission denied with instructions to enable in browser settings

### 6. Test Session (`app/test/[testId]/page.tsx`)

Full-screen layout, no navigation header. This is the core of the app.

**Test flow state machine:**

```
INTRODUCTION → SECTION_START → PREPARATION → RECORDING → UPLOADING → NEXT_PROMPT_OR_SECTION → COMPLETION
```

| State | UI | Details |
|-------|----|---------|
| **INTRODUCTION** | Test name, number of sections, time expectations, "Start Test" button | Fetch test structure on mount |
| **SECTION_START** | Section title, description, "Begin Section" button | — |
| **PREPARATION** | Prompt text prominently, countdown timer (e.g., 30s), webcam preview (not recording), "Start Recording" button or auto-start | Uses `useCountdown` hook |
| **RECORDING** | Red pulsing dot + "REC" text, recording timer (0:00 → max), countdown warning at 30s remaining, stop button, auto-stop at max duration | Uses `useRecording` hook |
| **UPLOADING** | Progress indicator, retry option on failure, "Skip and continue" option | FormData POST with retry (max 3 attempts, exponential backoff) |
| **NEXT_PROMPT_OR_SECTION** | Brief transition screen with next prompt info | Advance section/prompt index in TestContext |
| **COMPLETION** | "Test Complete!" message, summary (sections, prompts answered, recordings uploaded), "View Results" or "Return to Dashboard" | — |

**Recording implementation:**
- MediaRecorder API with `video/webm;codecs=vp9,opus` (fallback to `video/webm`)
- Record in chunks (timeslice: 1000ms)
- On stop: create Blob from chunks
- Upload via `POST` with FormData
- Retry up to 3 times with exponential backoff on network failure

### 7. Results Page (`app/results/page.tsx`)

- Protected route
- List of all completed tests with score previews
- Filter/sort options (date, score, pending vs graded)
- Click on a result → navigate to individual result detail

### 8. Result Detail (`app/results/[resultId]/page.tsx`)

- Large score display (overall score, e.g., "7.5 / 9.0")
- Score breakdown per category: Pronunciation, Fluency, Vocabulary, Grammar
- Visual representation (bar chart or gauge using pure CSS/SVG — no chart library)
- Detailed written feedback for each category
- Overall feedback section
- Date taken, test name metadata
- "Back to Results" link

### 9. Profile Page (`app/profile/page.tsx`)

- User information display/edit: name, email (read-only), target score
- Change password form (current password, new password, confirm)
- Account statistics: total tests, join date, improvement trend
- Save button with confirmation toast

## Global Styles (`app/globals.css`)

**CSS Variables:**

```css
:root {
  --primary: #2563eb;       /* blue-600 */
  --primary-dark: #1d4ed8;  /* blue-700 */
  --accent: #10b981;        /* emerald-500 */
  --danger: #ef4444;        /* red-500 */
  --warning: #f59e0b;       /* amber-500 */
  --background: #ffffff;
  --foreground: #0f172a;    /* slate-900 */
  --muted: #64748b;         /* slate-500 */
  --border: #e2e8f0;        /* slate-200 */
}
```

**Features:**
- Tailwind CSS import via `@import "tailwindcss"`
- Dark mode support via `prefers-color-scheme`
- Smooth scroll (`scroll-behavior: smooth`)
- Form autofill styling (match input background)
- `fadeInUp` entrance animation for auth cards
- Reduced motion support (`prefers-reduced-motion: reduce`)
- Custom focus ring styles

## Root Layout (`app/layout.tsx`)

- Wrap entire app with `AuthProvider` context
- Include `<Header />` on all pages **except** test session pages (test layout omits header)
- Metadata: title "FluentCheck — English Proficiency Test", proper description
- Include viewport meta for mobile
- Load Geist fonts

## Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| **API errors** | Global error handling in API wrapper; show toast/snackbar for unexpected errors |
| **Network offline** | Detect `navigator.onLine`; show "You appear to be offline" banner; queue recordings for retry |
| **Browser permissions denied** | Show helpful instructions on how to re-enable camera/mic in browser settings |
| **Empty dashboard** | "No tests yet. Start your first assessment!" |
| **Results without feedback** | "Your test is being reviewed by our expert jury. Check back soon." |
| **Token expiry** | Auto-redirect to login with message "Session expired. Please log in again." |
| **Recording upload failure** | Retry up to 3 times with exponential backoff; offer "Skip and continue" option |

## Responsive Design

- **Mobile-first approach**
- Test session pages: full-width on mobile, max-width container on desktop
- Dashboard: single column on mobile, two-column layout on `md+`
- Forms: full-width on mobile, `max-w-md` centered on desktop
- Touch-friendly buttons (min 44px tap target)
- Test recording UI: large controls suitable for touch interaction

## Accessibility

- All interactive elements focusable and operable via keyboard
- Form inputs have associated `<label>` elements
- Loading states announced via `aria-live` regions
- Color contrast meets WCAG AA standards
- Skip-to-content link at top of page
- Recording status announced to screen readers
- `aria-busy` on buttons during loading states
- Focus trap in modals
- Reduced motion support

## Security Checklist

- [ ] JWT stored in `localStorage`, sent via `Authorization: Bearer` header
- [ ] On 401 responses, auto-logout and redirect to login
- [ ] Password fields use `type="password"` with autocomplete attributes
- [ ] No sensitive data logged to console
- [ ] Video uploads use `FormData` (no base64 encoding in JSON)
- [ ] File upload MIME type validated on frontend before sending
- [ ] All user inputs sanitized before display (React escapes by default)
- [ ] HTTPS-only in production (secure cookie flag)

## Implementation Order

1. **Foundation**: Types (`types/`), API layer (`lib/api.ts`), `AuthContext`, layout components (`Header`, `Footer`)
2. **Auth**: Login and Signup pages with `LoginForm` / `SignupForm` components
3. **Dashboard**: Stats summary, test history list, protected route logic
4. **Hardware Check**: `DeviceCheckPanel`, `useMediaDevices` hook with real-time mic level
5. **Test Session**: `TestContext`, all test components (`PromptDisplay`, `PrepTimer`, `WebcamPreview`, `RecordingController`, `RecordingTimer`, `SectionNavigator`, `TestCompletionScreen`), MediaRecorder integration
6. **Results**: Results list, result detail with score visualization
7. **Profile**: Profile page with password change
8. **Polish**: Responsive refinements, loading states, error handling, accessibility audit

## Boundaries

- ✅ **Always:** Write to `app/`, `components/`, `contexts/`, `hooks/`, `lib/`, `types/`; run `npm run build` before commits; use native `fetch` (never install Axios); follow the PRD test flow state machine
- ⚠️ **Ask first:** Adding dependencies (zod is pre-approved for form validation); modifying `next.config.ts` or `eslint.config.mjs`; changing the Tailwind theme; any backend schema changes
- 🚫 **Never:** Commit secrets or API keys; edit `node_modules/` or `vendor/`; modify `backend/` files; use Axios or other HTTP libraries; write CSS modules or styled-components (Tailwind only)