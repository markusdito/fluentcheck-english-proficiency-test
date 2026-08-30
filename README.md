# FluentCheck

FluentCheck is a full-stack English speaking assessment platform. Candidates
record timed video responses in the browser, submit them for review, and receive
a criterion-by-criterion proficiency score from human examiners.

The project covers the complete assessment workflow: browser media capture,
direct cloud uploads, payments, examiner assignment, rubric-based scoring, and
role-specific administration.

## What the Product Does

| Role | Experience |
| --- | --- |
| Candidate | Creates an account, completes camera and microphone checks, records timed speaking answers, pays the assessment fee when required, and reviews scores and examiner feedback. |
| Examiner | Opens assigned submissions, reviews prompt audio and candidate videos, scores every answer, and leaves written feedback. |
| Administrator | Manages users and roles, maintains the question bank, uploads prompt audio, controls payment requirements, reviews submissions, and assigns examiners. |

The assessment currently uses a six-band rubric. Each answer is evaluated on
pronunciation, fluency, vocabulary, and grammar, with half-band values from 1.0
to 6.0. Completed examiner scores are aggregated into the candidate's result.

## Engineering Highlights

- **Browser-native assessment flow** — camera and microphone permission checks,
  preparation timers, prompt audio, `MediaRecorder` video capture, automatic
  stopping, and upload progress are coordinated in the Next.js client.
- **Direct-to-object-storage uploads** — the API creates scoped presigned URLs so
  large video files travel directly from the browser to Cloudflare R2 instead
  of passing through the Express server.
- **Protected media access** — stored objects use server-controlled keys and
  time-limited signed URLs. Submission ownership and examiner assignments are
  checked before private recordings are exposed.
- **Role-aware workflows** — candidates, examiners, and administrators share one
  application while JWT authentication and server-side authorization enforce
  their separate capabilities.
- **Backend-owned Google authentication** — Google Authorization Code + PKCE
  uses verified stable identities, safe account linking, and the same hardened
  JWT session boundary as local authentication.
- **Explicit assessment lifecycle** — submissions move through recording,
  payment, examiner review, and scored-result states, with transactional updates
  around assignment and grading operations.
- **Human scoring model** — the backend validates rubric completeness, prevents
  duplicate or out-of-assignment scores, and calculates aggregate results without
  premature rounding.
- **Payment integration** — iPaymu hosted checkout, signed callback validation,
  payment reconciliation, and an administrator-controlled payment waiver are
  integrated into the submission flow.

## Assessment Workflow

```text
Candidate records answers
          |
          v
Videos upload directly to Cloudflare R2
          |
          v
Submission completed
          |
          +---- payment enabled ----> iPaymu checkout ----+
          |                                               |
          +---- payment waived ---------------------------+
                                                          v
                                               Examiner assignment
                                                          |
                                                          v
                                             Rubric scoring and feedback
                                                          |
                                                          v
                                                Candidate result report
```

## Architecture

```mermaid
flowchart LR
    Browser[Next.js web application]
    API[Express API]
    Database[(PostgreSQL)]
    Storage[(Cloudflare R2)]
    Payment[iPaymu]
    Google[Google OAuth]

    Browser -->|JSON through Next.js rewrite| API
    API -->|Prisma| Database
    API -->|Presigned URLs and object metadata| Storage
    Browser -->|Direct video and audio upload| Storage
    API -->|Create checkout| Payment
    Payment -->|Signed payment callback| API
    Browser -->|Authorization Code + PKCE| Google
    Google -->|Callback through frontend rewrite| API
```

The frontend uses a same-origin `/backend-api` rewrite during local development.
The Express application is organized into routes, controllers, and services,
with Prisma providing typed access to PostgreSQL.

## Technology Stack

| Area | Technologies |
| --- | --- |
| Frontend | Next.js 16.2.6, React 19.2.4, TypeScript 5, Tailwind CSS 4, Base UI and shadcn-style components |
| Backend | Node.js, Express 5.2.1, TypeScript 6, Prisma 7.8 |
| Data | PostgreSQL, Prisma migrations |
| Media | MediaRecorder API, Cloudflare R2, AWS S3-compatible SDK |
| Authentication | JWT in HTTP-only cookies, bcrypt password hashing, role-based authorization |
| Payments | iPaymu hosted checkout and callback integration |
| Quality | Node.js test runner, ESLint, strict TypeScript configurations |

## Repository Structure

```text
.
|-- frontend/
|   |-- app/          # Next.js App Router pages
|   |-- components/   # Shared and role-specific UI
|   |-- hooks/        # Media recording and device hooks
|   |-- lib/          # Typed API clients
|   `-- types/        # Frontend domain types
|-- backend/
|   |-- src/
|   |   |-- routes/       # Express route definitions
|   |   |-- controllers/  # HTTP request handling
|   |   |-- service/      # Domain and persistence logic
|   |   `-- middleware/   # Authentication and authorization
|   |-- prisma/       # Schema, migrations, and development seed
|   `-- test/         # Backend domain tests
`-- docs/             # Product and implementation documentation
```

For more detail, see the
[frontend architecture](frontend/docs/FRONTEND_ARCHITECTURE.md),
[backend architecture](backend/docs/BACKEND_ARCHITECTURE.md), and
[Google OAuth deployment](backend/docs/GOOGLE_AUTH.md) documents.

## Running Locally

### Prerequisites

- Node.js and npm
- PostgreSQL
- Docker for the disposable PostgreSQL payment integration suite
- A Cloudflare R2 bucket and S3-compatible credentials
- iPaymu sandbox credentials if you want to exercise the payment flow
- A modern browser with camera and microphone access

### 1. Clone and install

```bash
git clone https://github.com/markusdito/fluentcheck-english-proficiency-test.git
cd fluentcheck-english-proficiency-test

cd backend
npm install

cd ../frontend
npm install
```

### 2. Configure the backend

Create `backend/.env`:

```env
# Application
PORT=5001
FRONTEND_URL="http://localhost:3000"

# Database and authentication
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN="1h"

# Google OAuth (server-only; use the exact callback URI from the deployment guide)
GOOGLE_CLIENT_ID="123456789.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="server-only-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/backend-api/auth/google/callback"

# Cloudflare R2
R2_ACCOUNT_ID="your-account-id"
R2_ACCESS_KEY_ID="your-access-key-id"
R2_SECRET_ACCESS_KEY="your-secret-access-key"
R2_BUCKET_NAME="your-bucket-name"

# iPaymu payment flow
IPAYMU_VA_NUMBER="your-va-number"
IPAYMU_API_KEY="your-api-key"
IPAYMU_ENV="sandbox"
IPAYMU_NOTIFY_URL="https://your-public-api.example.com/api/payments/ipaymu/notify"
IPAYMU_PAYMENT_AMOUNT="150000"
IPAYMU_CURRENCY="IDR"
```

The iPaymu values are only needed when payment is enabled. Its notification URL
must be publicly reachable so iPaymu can deliver payment status callbacks.

### 3. Configure the frontend

Create `frontend/.env.local`:

```env
BACKEND_URL="http://localhost:5001"
```

`BACKEND_URL` is used by the Next.js rewrite that proxies browser requests from
`/backend-api/*` to the Express API.

### 4. Prepare the database

```bash
cd backend
npx prisma generate
npx prisma migrate dev
```

To create development questions and examiner records, you can run:

```bash
npx prisma db seed
```

> [!CAUTION]
> The current seed clears assessment data—including questions, submissions,
> payments, assignments, answers, and scores—before recreating sample records.
> Run it only against a disposable development database.

### 5. Start both applications

Run the backend in one terminal:

```bash
cd backend
npm run dev
```

Run the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The API listens on
`http://localhost:5001` by default.

## Commands

### Frontend

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

### Backend

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Express with automatic restarts |
| `npm run test:unit` | Run the fast backend unit suite without Docker |
| `npm run test:integration` | Run HTTP and concurrency tests against disposable PostgreSQL |
| `npm test` | Run the complete unit and integration suite |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm run start` | Run the compiled API |
| `npx prisma generate` | Generate the Prisma client |
| `npx prisma migrate dev` | Apply development migrations |

## Validation

The fast backend suite covers domain logic such as scoring and iPaymu signature
canonicalization. The integration suite starts a disposable PostgreSQL container
and exercises the Payment HTTP API, migrations, retries, callbacks, concurrency,
and admin reconciliation history. Run the complete gate with:

```bash
cd backend
npm test
```

The current implementation covers the product journey from account creation and
recorded assessment through payment, examiner review, and scored result reporting.
