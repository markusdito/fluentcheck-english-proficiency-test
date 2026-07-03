# FluentCheck — Frontend Generation Prompt

## Overview
Generate a complete Next.js frontend for **FluentCheck**, an English proficiency assessment platform where users record video responses to speaking prompts and receive expert jury feedback.

**Stack:**
- Framework: Next.js (App Router) + TypeScript
- Styling: Tailwind CSS v4.3
- Video Recording: MediaRecorder API (browser-native)
- HTTP Client: native `fetch` (no Axios)
- State Management: React Context + local state
- Form Validation: zod

**Existing project root:** `/fluentcheck-english-proficiency-test`
**Frontend directory:** `frontend/`
**Backend (already built):** Express.js + Prisma + PostgreSQL + JWT auth

---

## Project Structure

Generate the following file structure inside `frontend/`:

```
frontend/
├── app/
│   ├── layout.tsx                 # Root layout (already exists — update)
│   ├── page.tsx                   # Landing/Home page (already exists — replace)
│   ├── globals.css                # Global styles (already exists — update)
│   ├── login/
│   │   └── page.tsx               # Login page
│   ├── signup/
│   │   └── page.tsx               # Registration page
│   ├── dashboard/
│   │   ├── page.tsx               # Dashboard (test history + "Start New Test")
│   │   └── loading.tsx            # Dashboard loading state
│   ├── test/
│   │   ├── [testId]/
│   │   │   ├── page.tsx           # Active test session page
│   │   │   └── layout.tsx         # Layout for test (no nav)
│   │   └── hardware-check/
│   │       └── page.tsx           # Webcam/mic permission check
│   ├── results/
│   │   ├── page.tsx               # All results listing
│   │   └── [resultId]/
│   │       └── page.tsx           # Individual result detail
│   └── profile/
│       └── page.tsx               # User profile settings
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
│   ├── AuthContext.tsx            # JWT auth state, login/logout/signup
│   └── TestContext.tsx            # Active test session state
├── lib/
│   ├── api.ts                    # Base fetch wrapper with JWT handling
│   ├── auth-api.ts               # Auth-specific API calls
│   ├── test-api.ts               # Test/session API calls
│   ├── results-api.ts            # Results/feedback API calls
│   ├── user-api.ts               # User profile API calls
│   └── media-recorder.ts         # MediaRecorder abstraction utilities
├── types/
│   ├── auth.ts                   # User, LoginRequest, SignupRequest, AuthResponse
│   ├── test.ts                   # TestSession, TestSection, Prompt, Recording
│   ├── results.ts                # TestResult, ScoreBreakdown, Feedback
│   └── api.ts                    # Generic ApiResponse<T>, ApiError types
└── hooks/
    ├── useAuth.ts                # Convenience hook for AuthContext
    ├── useMediaDevices.ts        # Webcam/mic permission & stream management
    ├── useRecording.ts           # MediaRecorder state machine
    └── useCountdown.ts           # Generic countdown timer hook
```

---

## Detailed Requirements

### 1. Authentication (AuthContext + auth pages)

**AuthContext** (`contexts/AuthContext.tsx`):
- Stores: `user`, `token`, `isLoading`, `isAuthenticated`
- Exposes: `login(email, password)`, `signup(name, email, password, targetScore?)`, `logout()`
- On mount: reads token from `localStorage`, validates with `/api/auth/me`, sets user or clears
- All subsequent API calls automatically attach `Authorization: Bearer <token>` header
- On 401 responses, auto-logout

**Login Page** (`app/login/page.tsx`):
- Clean centered card layout
- Email + password fields
- Submit button with loading state
- Error display (invalid credentials, server error)
- Link to signup page
- After login, redirect to `/dashboard`
- If already authenticated, redirect to `/dashboard`

**Signup Page** (`app/signup/page.tsx`):
- Name, email, password, confirm password, optional target score
- Validation: email format, password min 8 chars, passwords match
- Show validation errors inline
- Submit with loading state
- Link to login page
- On success, auto-login and redirect to `/hardware-check` (first-time flow)

### 2. Landing Page (`app/page.tsx`)
- Hero section with app name, tagline, and CTA buttons
- Features overview (3-4 feature cards)
- Call-to-action: "Get Started" (if not authenticated) or "Go to Dashboard" (if authenticated)
- Professional, clean design — no Next.js boilerplate
- Footer with basic links

### 3. Dashboard (`app/dashboard/page.tsx`)
- Protected route (redirect to `/login` if not authenticated)
- Welcome message with user's name
- Stats summary card: total tests taken, average score, best score
- "Start New Test" prominent CTA button → navigates to `/test/hardware-check`
- Test history list (paginated, scrollable)
- Each history item shows: date, score badge (if graded) or "Pending" badge, section name
- Loading skeleton state

### 4. Hardware Check (`app/test/hardware-check/page.tsx`)
- Large webcam preview (real-time from `getUserMedia`)
- Mic level indicator (audio volume visualization using AnalyserNode)
- Check items with status indicators:
  - ✅ Webcam detected / ❌ No webcam
  - ✅ Microphone detected / ❌ No mic
  - ✅ Permission granted / ❌ Permission denied
- "Retry" button for each failed check
- "Continue to Test" button (enabled only when all checks pass)
- Explanation text about why webcam/mic are needed
- Edge cases: handle no devices, permission denied with instructions to enable in browser settings

### 5. Test Session (`app/test/[testId]/page.tsx`)
- This is the core of the app. Layout should be full-screen, no navigation header.

**Test flow (state machine):**
```
INTRODUCTION → SECTION_START → PREPARATION → RECORDING → UPLOADING → NEXT_PROMPT_OR_SECTION → COMPLETION
```

- **Introduction screen**: Display test name, number of sections, time expectations. "Start Test" button.
- **Section start screen**: Section title, description. "Begin Section" button.
- **Preparation phase**:
  - Display the prompt text prominently
  - Countdown timer (e.g., 30 seconds)
  - Webcam preview shown (not recording yet)
  - "Start Recording" button or auto-start when timer ends
- **Recording phase**:
  - Recording indicator (red pulsing dot + "REC" text)
  - Recording timer (e.g., 0:00 → 2:00)
  - Countdown warning at 30 seconds remaining
  - Stop button to end recording early
  - Auto-stop when max duration reached
  - Webcam preview continues showing recording
- **Uploading phase**:
  - Progress indicator
  - If upload fails: retry option, "Skip and continue" option
  - Store recording data in memory until uploaded
- **Between prompts**: brief transition screen with next prompt info
- **Test completion screen**:
  - "Test Complete!" message
  - Summary: number of sections, prompts answered, recordings uploaded
  - "View Results" button (if results ready) or "Return to Dashboard"

**Section/Prompt data flow:**
- Fetch test structure from API on mount: `GET /api/tests/:testId`
- Structure: `{ sections: [{ id, title, description, prompts: [{ id, text, prepTime, recordingDuration }] }] }`
- Track current section index and prompt index in TestContext
- On each prompt completion (after upload), advance to next prompt/section

**Recording Implementation:**
- Use MediaRecorder API with `{ mimeType: 'video/webm;codecs=vp9,opus' }` (fall back to `video/webm`)
- Record in chunks (timeslice: 1000ms for progress tracking)
- On stop: create a Blob from recorded chunks
- Upload via `POST /api/tests/:testId/sections/:sectionId/prompts/:promptId/recordings` with FormData
- Handle network interruptions with retry (max 3 attempts, exponential backoff)

### 6. Results Page (`app/results/page.tsx`)
- Protected route
- List of all completed tests with score previews
- Filter/sort options (date, score, pending vs graded)
- Click on a result → navigate to individual result detail

### 7. Result Detail (`app/results/[resultId]/page.tsx`)
- Large score display (overall score, e.g., "7.5 / 9.0")
- Score breakdown per category:
  - Pronunciation (e.g., 7.0)
  - Fluency (e.g., 7.5)
  - Vocabulary (e.g., 8.0)
  - Grammar (e.g., 7.0)
- Visual representation (bar chart or gauge using pure CSS/SVG — no chart library)
- Detailed written feedback for each category
- Overall feedback section
- Date taken, test name metadata
- "Back to Results" link

### 8. Profile Page (`app/profile/page.tsx`)
- User information display/edit: name, email (read-only), target score
- Change password form (current password, new password, confirm)
- Account statistics: total tests, join date, improvement trend
- Save button with confirmation toast

### 9. UI Components Specification

**Button.tsx:**
- Props: `variant` ('primary' | 'secondary' | 'outline' | 'ghost' | 'danger'), `size` ('sm' | 'md' | 'lg'), `loading`, `disabled`, `fullWidth`, `children`, `onClick`, `type`
- Loading state: show spinner and disable interaction
- Tailwind: rounded-lg, font-medium, transition-all

**Card.tsx:**
- Props: `children`, `className`, `padding` (boolean, default true)
- White bg, subtle shadow, rounded-xl, border

**Input.tsx:**
- Props: `label`, `error`, `helperText`, `type`, `placeholder`, `value`, `onChange`, `required`, `disabled`, `icon`
- Error state: red border + error message below
- Include `<label>` element for accessibility

**Modal.tsx:**
- Props: `open`, `onClose`, `title`, `children`, `size` ('sm' | 'md' | 'lg')
- Backdrop with click-to-close, ESC key to close
- Focus trap within modal
- Animate in/out (opacity + slight scale)

**Badge.tsx:**
- Props: `variant` ('success' | 'warning' | 'error' | 'info' | 'default'), `children`
- Used for score display, status indicators

**Spinner.tsx:**
- Props: `size` ('sm' | 'md' | 'lg'), `className`
- CSS-only spinning animation (Tailwind animate-spin)

**ProgressBar.tsx:**
- Props: `value` (0-100), `variant` ('primary' | 'success' | 'warning'), `showLabel`, `className`
- Animated width transition

### 10. Layout Components

**Header.tsx:**
- If authenticated: logo, nav links (Dashboard, Results, Profile), user avatar/name dropdown with logout
- If not authenticated: logo, nav links (Home, Login, Signup)
- Responsive: hamburger menu on mobile
- Sticky top with backdrop blur

### 11. API Layer (`lib/`)

**api.ts — Base fetch wrapper:**
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

**Endpoint mapping (based on existing Express backend):**
```
POST   /api/auth/register         → Signup
POST   /api/auth/login            → Login
GET    /api/auth/me               → Get current user
PUT    /api/auth/profile          → Update profile
PUT    /api/auth/password         → Change password

GET    /api/tests                 → List available tests
GET    /api/tests/:testId         → Get test structure (sections, prompts)

POST   /api/tests/:testId/start   → Start a new test session
GET    /api/tests/:testId/sessions/:sessionId  → Get session state

POST   /api/sessions/:sessionId/sections/:sectionId/prompts/:promptId/recordings
       → Upload recording (FormData with video blob)

GET    /api/results               → List user's results
GET    /api/results/:resultId     → Get result detail with scores/feedback
```

### 12. Types (`types/`)

**auth.ts:**
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

**test.ts:**
```typescript
export interface Prompt {
  id: string;
  text: string;
  prepTime: number;       // seconds
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

**results.ts:**
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

**api.ts:**
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

### 13. Hooks Specification

**useMediaDevices.ts:**
- Manages `getUserMedia` stream lifecycle
- States: `{ stream, videoDevices, audioDevices, videoError, audioError, isLoading }`
- Methods: `requestPermissions()`, `stopStream()`
- Detect device list changes (plug/unplug)

**useRecording.ts:**
- MediaRecorder state machine wrapper
- States: `idle` | `preparing` | `recording` | `stopped` | `uploading` | `error`
- Methods: `startRecording()`, `stopRecording()`, `pauseRecording()`, `resumeRecording()`
- Returns: `{ state, blob, duration, error, startRecording, stopRecording }`
- Handles MIME type fallback
- Emits `onChunk` callback for progress monitoring

**useCountdown.ts:**
- `useCountdown(initialSeconds: number, onComplete?: () => void)`
- Returns: `{ seconds, isRunning, isComplete, start, pause, reset }`
- Formatted time getter: `formatted` (e.g., "0:45")

### 14. Global Styles (`app/globals.css`)
- Keep Tailwind import
- Custom CSS variables for brand colors:
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
- Dark mode support via media prefers-color-scheme
- Smooth scroll, box-sizing reset

### 15. Root Layout (`app/layout.tsx`)
- Wrap entire app with `AuthProvider` context
- Include `<Header />` on all pages except test session pages (use test layout that omits header)
- Metadata: title "FluentCheck — English Proficiency Test", proper description
- Include viewport meta for mobile
- Load Geist fonts (keep existing)

### 16. Error Handling & Edge Cases

- **API errors**: Global error handling in API wrapper. Show toast/snackbar for unexpected errors.
- **Network offline**: Detect `navigator.onLine`, show "You appear to be offline" banner. Queue recordings for retry.
- **Browser permissions**: If user denies camera/mic, show helpful instructions on how to re-enable in browser settings.
- **Empty states**: Dashboard without tests → "No tests yet. Start your first assessment!"
- **Results without feedback**: "Your test is being reviewed by our expert jury. Check back soon."
- **Token expiry**: Auto-redirect to login with message "Session expired. Please log in again."
- **Retry logic**: Network requests (especially recording uploads) should retry up to 3 times with exponential backoff.

### 17. Responsive Design

- Mobile-first approach
- Test session pages: full-width on mobile, max-width container on desktop
- Dashboard: single column on mobile, two-column layout on md+
- Forms: full-width on mobile, max-w-md centered on desktop
- Touch-friendly buttons (min 44px tap target)
- Test recording UI: large controls suitable for touch interaction

### 18. Accessibility

- All interactive elements focusable and operable via keyboard
- Form inputs have associated `<label>` elements
- Loading states announced via aria-live regions
- Color contrast meets WCAG AA standards
- Skip-to-content link at top of page
- Recording status announced to screen readers

---

## Implementation Order (suggested)

1. **Foundation**: Types, API layer, AuthContext, layout components
2. **Auth**: Login, Signup pages with form components
3. **Dashboard**: Stats, test history list
4. **Hardware Check**: DeviceCheckPanel, useMediaDevices hook
5. **Test Session**: TestContext, all test components, MediaRecorder integration
6. **Results**: Results list, result detail with score visualization
7. **Profile**: Profile page with password change
8. **Polish**: Responsive refinements, loading states, error handling, accessibility

---

## Notes

- Use Tailwind CSS utility classes for all styling — no CSS modules or styled-components
- This is **Next.js 16.x (App Router)** — use `next/link` for navigation, `next/navigation` for `useRouter`, `useSearchParams`, etc.
- Server Components are allowed where no client interactivity is needed (loading.tsx, some static pages)
- Use `"use client"` directive for interactive components