# FluentCheck — Backend Generation Prompt

## Overview
Generate a complete Express.js backend for **FluentCheck**, an English proficiency assessment platform where students record video responses to speaking prompts and receive expert jury feedback.

**Stack:**
- Runtime: Node.js 20.x + Express.js 5.2.1 (ES Modules)
- Language: TypeScript 6.x (strict mode, `NodeNext` module resolution)
- ORM: Prisma 7.8.0 with `prisma-client` generator (output: `src/generated/`)
- Database: PostgreSQL 15+ (via `@prisma/adapter-pg` driver adapter)
- Authentication: JWT (jsonwebtoken) + bcryptjs
- Cookies: cookie-parser for httpOnly cookie support
- CORS: enabled with credentials for frontend communication
- File Uploads: Multer (for video blob handling) → Cloudflare R2 / AWS S3
- Environment: dotenv

**Existing project root:** `/fluentcheck-english-proficiency-test`
**Backend directory:** `backend/`
**Frontend (already built):** Next.js 16 + React 19 + Tailwind CSS v4

---

## Project Structure

Generate the following file structure inside `backend/`:

```
backend/
├── prisma/
│   ├── schema.prisma                # Database schema (already exists — maintain/extend)
│   └── migrations/                  # Migration history (auto-generated, never edit manually)
├── src/
│   ├── server.ts                    # Express app entry point
│   ├── config/
│   │   ├── db.ts                    # PrismaClient singleton with PG adapter
│   │   └── env.ts                   # Centralized env variable access
│   ├── controllers/
│   │   ├── auth.controller.ts       # Auth route handlers (register, login, me)
│   │   ├── question.controller.ts   # Question CRUD handlers
│   │   ├── submission.controller.ts # Test submission handlers
│   │   ├── answer.controller.ts     # Answer/video upload handlers
│   │   ├── payment.controller.ts    # Payment processing handlers
│   │   ├── examiner.controller.ts   # Examiner assignment & scoring handlers
│   │   ├── result.controller.ts     # Result/certificate handlers
│   │   └── admin.controller.ts      # Admin management handlers
│   ├── service/
│   │   ├── auth.service.ts          # Password hashing, comparison, user validation
│   │   ├── question.service.ts      # Question/Task query logic
│   │   ├── submission.service.ts    # Submission lifecycle management
│   │   ├── answer.service.ts        # Video metadata, storage key generation
│   │   ├── payment.service.ts       # Payment gateway integration logic
│   │   ├── examiner.service.ts      # Assignment creation, score aggregation
│   │   ├── result.service.ts        # Result calculation, certificate generation
│   │   └── storage.service.ts       # S3/R2 upload abstraction
│   ├── routes/
│   │   ├── auth.routes.ts           # /api/auth/*
│   │   ├── question.routes.ts       # /api/questions/*
│   │   ├── submission.routes.ts     # /api/submissions/*
│   │   ├── answer.routes.ts         # /api/submissions/:id/answers/*
│   │   ├── payment.routes.ts        # /api/payments/*
│   │   ├── examiner.routes.ts       # /api/examiner/*
│   │   ├── result.routes.ts         # /api/results/*
│   │   └── admin.routes.ts          # /api/admin/*
│   ├── middleware/
│   │   ├── auth.middleware.ts       # JWT verification middleware
│   │   ├── role.middleware.ts       # Role-based access control (STUDENT/EXAMINER/ADMIN)
│   │   ├── validate.middleware.ts   # Request body validation helper
│   │   ├── upload.middleware.ts     # Multer configuration for video uploads
│   │   └── error.middleware.ts      # Global error handler
│   ├── utils/
│   │   ├── jwt.ts                   # JWT sign/verify helpers
│   │   ├── response.ts              # Standardized API response helpers
│   │   └── constants.ts             # Shared constants (SALT_ROUNDS, MAX_UPLOAD_SIZE, etc.)
│   └── generated/                   # Prisma client (auto-generated, never edit)
├── .env                             # Environment variables (never commit)
├── .env.example                     # Template for required env vars
├── .gitignore
├── package.json
├── tsconfig.json
└── prisma.config.ts                 # Prisma configuration
```

---

## Detailed Requirements

### 1. Environment Configuration (`src/config/env.ts`)

Centralized, typed access to all environment variables:

```typescript
export const env = {
  // Server
  PORT: parseInt(process.env.PORT ?? "5000", 10),
  NODE_ENV: process.env.NODE_ENV ?? "development",

  // Database
  DATABASE_URL: process.env.DATABASE_URL!,

  // JWT
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "1h",

  // CORS
  CLIENT_URL: process.env.CLIENT_URL ?? "http://localhost:3000",

  // Storage (S3/R2)
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
  STORAGE_ACCESS_KEY: process.env.STORAGE_ACCESS_KEY,
  STORAGE_SECRET_KEY: process.env.STORAGE_SECRET_KEY,
  STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? "fluentcheck-recordings",

  // Payment (future)
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  PAYMENT_API_KEY: process.env.PAYMENT_API_KEY,
} as const;
```

Required `.env` variables:
```
DATABASE_URL="postgresql://user:password@localhost:5432/fluentcheck"
JWT_SECRET="your-secret-key-here"
JWT_EXPIRES_IN="1h"
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000
```

### 2. Database Configuration (`src/config/db.ts`)

```typescript
import { PrismaClient } from "../generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development"
    ? ["query", "error", "warn"]
    : ["error"],
});

const connectDB = async () => { /* ... */ };
const disconnectDB = async () => { /* ... */ };

export { prisma, connectDB, disconnectDB };
```

**Key rules:**
- Always use `PrismaPg` adapter — never the default Rust engine
- Import from `../generated/client.js`, NOT from `@prisma/client`
- Single PrismaClient instance shared across the app
- Graceful shutdown: call `disconnectDB()` on SIGTERM/SIGINT

### 3. Authentication System

**Service Layer (`src/service/auth.service.ts`):**
```typescript
import bcrypt from "bcryptjs";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS); // SALT_ROUNDS = 10
}

export async function authenticateUser(
  plainPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  return null;
}
```

**JWT Utility (`src/utils/jwt.ts`):**
```typescript
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function generateToken(userId: string, res: Response): string {
  const payload = { id: userId };
  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

  res.cookie("jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return token;
}

export function verifyTokenString(token: string): { id: string } {
  return jwt.verify(token, env.JWT_SECRET) as { id: string };
}
```

**Auth Middleware (`src/middleware/auth.middleware.ts`):**
```typescript
import type { Request, Response, NextFunction } from "express";
import { verifyTokenString } from "../utils/jwt.js";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

export function verifyToken(req: Request, res: Response, next: NextFunction) {
  // 1. Try Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = verifyTokenString(token);
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  }

  // 2. Try httpOnly cookie
  const cookieToken = req.cookies?.jwt;
  if (cookieToken) {
    try {
      const decoded = verifyTokenString(cookieToken);
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  }

  return res.status(401).json({ error: "Authentication required" });
}
```

**Role Middleware (`src/middleware/role.middleware.ts`):**
```typescript
import { prisma } from "../config/db.js";
import type { Request, Response, NextFunction } from "express";
import type { Role } from "../generated/enums.js";

export function requireRole(...roles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { role: true },
    });

    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}
```

**Auth Controller (`src/controllers/auth.controller.ts`):**

```typescript
// POST /api/auth/register
export async function register(req: Request, res: Response) {
  // 1. Extract and validate { name, email, password }
  // 2. Check email uniqueness → 409 if taken
  // 3. Hash password with authService.hashPassword()
  // 4. Create User with role: STUDENT (default)
  // 5. Generate JWT, set httpOnly cookie
  // 6. Return { status: "success", data: { user: { id, name, email, createdAt }, token } }
  // ⚠️ NEVER return password field — use select to exclude
}

// POST /api/auth/login
export async function login(req: Request, res: Response) {
  // 1. Extract and validate { email, password }
  // 2. Find user by email → 401 if not found
  // 3. await authenticateUser(password, user.password) → 401 if false
  //    ⚠️ CRITICAL: bcrypt.compare() is async — always await it!
  // 4. Generate JWT, set httpOnly cookie
  // 5. Return { status: "success", data: { user: { id, name, email, createdAt }, token } }
  // ⚠️ NEVER return password field
}

// GET /api/auth/me (requires verifyToken middleware)
export async function getMe(req: Request, res: Response) {
  // 1. Get userId from req.user.id (set by verifyToken)
  // 2. Fetch user from DB with select (exclude password)
  // 3. Return { status: "success", data: { user } }
}

// PUT /api/auth/profile (requires verifyToken)
export async function updateProfile(req: Request, res: Response) {
  // Update user's username, targetScore (if added to schema)
  // Return updated user
}

// PUT /api/auth/password (requires verifyToken)
export async function changePassword(req: Request, res: Response) {
  // 1. Extract { currentPassword, newPassword }
  // 2. Fetch user, verify currentPassword
  // 3. Hash newPassword, update user
  // 4. Return success message
}
```

**Auth Routes (`src/routes/auth.routes.ts`):**
```typescript
import { Router } from "express";
import { register, login, getMe, updateProfile, changePassword } from "../controllers/auth.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = Router();

// Public routes
router.post("/register", register);
router.post("/login", login);

// Protected routes
router.get("/me", verifyToken, getMe);
router.put("/profile", verifyToken, updateProfile);
router.put("/password", verifyToken, changePassword);

export default router;
```

### 4. Question Management

**Question Routes (`src/routes/question.routes.ts`):**
```
GET    /api/questions              → List all active questions (grouped by PART_1, PART_2, PART_3)
GET    /api/questions/:id          → Get single question with tasks
POST   /api/questions              → Create question (ADMIN only)
PUT    /api/questions/:id          → Update question (ADMIN only)
DELETE /api/questions/:id          → Soft delete question (ADMIN only)
```

**Question shape:**
```typescript
// A Question contains multiple Tasks (sub-prompts)
// Student records ONE video per Question answering all Tasks
{
  id: string;
  category: "PART_1" | "PART_2" | "PART_3";
  promptText: string;
  order: number;
  preparationSeconds: number;  // default 30
  recordingSeconds: number;    // default 120
  tasks: [
    { id: string, promptText: string, order: number }
  ]
}
```

### 5. Submission & Test Flow

**Submission Routes (`src/routes/submission.routes.ts`):**
```
POST   /api/submissions                    → Start new test (create Submission with status IN_PROGRESS)
GET    /api/submissions                    → List current user's submissions
GET    /api/submissions/:id                → Get submission detail with answers
POST   /api/submissions/:id/complete       → Mark submission as complete (all answers uploaded)
```

**Answer Routes (`src/routes/answer.routes.ts`):**
```
POST   /api/submissions/:submissionId/answers/:questionId
       → Upload video answer (multipart/form-data)
       → Stores metadata in DB, uploads video to S3/R2
       → Creates Answer record with uploadStatus: PENDING → UPLOADED

GET    /api/submissions/:submissionId/answers/:questionId
       → Get answer detail + signed URL for video playback
```

**Answer upload flow:**
```
1. Frontend sends POST with FormData containing video Blob
2. Multer middleware parses the file (memory storage, 500MB limit)
3. Generate storageKey: `submissions/{submissionId}/answers/{questionId}.webm`
4. Upload buffer to S3/R2 via storage.service.ts
5. Create Answer record: { submissionId, questionId, storageKey, mimeType, sizeBytes, uploadStatus: UPLOADED }
6. Return answer metadata
7. If all questions answered → Submission status: AWAITING_PAYMENT
```

### 6. Payment System

**Payment Routes (`src/routes/payment.routes.ts`):**
```
POST   /api/payments                → Create payment for a submission
GET    /api/payments/:id            → Get payment status
POST   /api/payments/webhook        → Payment provider webhook (no auth, verify signature)
GET    /api/submissions/:id/payment → Get payment for a submission
```

**Payment flow:**
```
1. Student completes all answers → Submission: AWAITING_PAYMENT
2. Frontend calls POST /api/payments with { submissionId }
3. Backend creates Payment record: { amount, currency: "IDR", status: PENDING }
4. Returns payment URL/QRIS/snap token from provider
5. Provider webhook → POST /api/payments/webhook → update Payment.status
6. On PAID → Submission: PAID → trigger examiner assignment
```

### 7. Examiner Assignment & Scoring

**Examiner Routes (`src/routes/examiner.routes.ts`):**
```
GET    /api/examiner/assignments              → List examiner's assignments (queue)
GET    /api/examiner/assignments/:id          → Get assignment detail with answers
PUT    /api/examiner/assignments/:id/start    → Mark assignment as IN_PROGRESS
POST   /api/examiner/assignments/:id/scores   → Submit scores for all answers
```

**Score submission flow:**
```
1. Examiner fetches assignment → sees list of Answers with video URLs
2. For each Answer, examiner provides:
   POST /api/examiner/assignments/:id/scores
   Body: {
     scores: [
       { answerId: "...", value: 85.5, comment: "Good fluency..." },
       { answerId: "...", value: 78.0, comment: "Needs work on..." }
     ]
   }
3. Backend creates Score records (unique per assignmentId+answerId)
4. Mark assignment as COMPLETED
5. If both examiners complete → Submission: SCORED
```

**Score model constraints:**
- `value`: Decimal(5,2), validated 0–100 at app level
- `@@unique([assignmentId, answerId])` — an examiner scores each answer exactly once
- Score is linked to both `ExaminerAssignment` and `Answer` (dual FK)

### 8. Results & Certificates

**Result Routes (`src/routes/result.routes.ts`):**
```
GET    /api/results              → List current user's results (with score previews)
GET    /api/results/:id          → Get detailed result with score breakdown
GET    /api/results/:id/certificate → Get certificate PDF download URL
```

**Result calculation:**
```
For a SCORED submission:
1. Fetch all Scores for the submission (from both examiners)
2. Average per-answer scores: (examiner1Score + examiner2Score) / 2
3. Calculate overall: average of all per-answer scores
4. Create Certificate: { submissionId, finalScore, issuedAt: now() }
5. Update Submission: SCORED → CERTIFIED
6. Generate PDF certificate → upload to S3/R2 → update certificate.storageKey
```

**Result response shape:**
```typescript
{
  id: string;
  submissionId: string;
  status: "SCORED" | "CERTIFIED";
  completedAt: string;
  score: {
    pronunciation: number;  // per-category average
    fluency: number;
    vocabulary: number;
    grammar: number;
    overall: number;        // weighted total
  };
  feedback: {
    pronunciation: string;  // aggregated examiner comments
    fluency: string;
    vocabulary: string;
    grammar: string;
    overall: string;
  };
  certificate?: {
    id: string;
    finalScore: number;
    issuedAt: string;
    downloadUrl: string;    // signed S3/R2 URL
  };
}
```

### 9. Admin Routes

**Admin Routes (`src/routes/admin.routes.ts`):**
```
GET    /api/admin/users                 → List all users (paginated)
PUT    /api/admin/users/:id/role        → Change user role
GET    /api/admin/submissions           → List all submissions (filterable)
POST   /api/admin/submissions/:id/assign → Assign examiners to a submission
GET    /api/admin/examiners             → List available examiners
GET    /api/admin/stats                 → Dashboard statistics
```

### 10. Server Entry Point (`src/server.ts`)

```typescript
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { connectDB, disconnectDB } from "./config/db.js";
import { env } from "./config/env.js";

// Routes
import authRoutes from "./routes/auth.routes.js";
import questionRoutes from "./routes/question.routes.js";
import submissionRoutes from "./routes/submission.routes.js";
import answerRoutes from "./routes/answer.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import examinerRoutes from "./routes/examiner.routes.js";
import resultRoutes from "./routes/result.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const app = express();

// Middleware stack (order matters!)
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "50mb" })); // large limit for base64 fallbacks

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/submissions", answerRoutes);    // nested under submissions
app.use("/api/payments", paymentRoutes);
app.use("/api/examiner", examinerRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Global error handler (must be last)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Startup
const PORT = env.PORT;

async function main() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  await disconnectDB();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await disconnectDB();
  process.exit(0);
});

main().catch(console.error);
```

### 11. Database Schema (already exists — key relationships)

```
User (STUDENT/EXAMINER/ADMIN)
 ├──→ Submission (1:N) — student takes many tests
 ├──→ ExaminerAssignment (1:N) — examiner grades many submissions
 └──→ Question (1:N, createdBy) — admin creates questions

Question (PART_1/PART_2/PART_3)
 ├──→ Task (1:N) — sub-prompts within the question
 └──→ Answer (1:N) — video responses from different students

Submission (IN_PROGRESS → AWAITING_PAYMENT → PAID → SCORING → SCORED → CERTIFIED)
 ├──→ Answer (1:N) — one video per question
 ├──→ Payment (1:N) — payment attempts
 ├──→ ExaminerAssignment (1:N, exactly 2) — two examiners per submission
 └──→ Certificate (1:1) — final certificate

Answer
 ├──→ Score (1:N) — scored by both examiners
 └── belongs to Submission + Question

ExaminerAssignment (ASSIGNED → IN_PROGRESS → COMPLETED)
 └──→ Score (1:N) — scores for each answer in the submission

Score
 └── belongs to ExaminerAssignment + Answer
```

### 12. API Response Conventions

**Success response:**
```typescript
// 200/201
{ status: "success", data: { ... } }
```

**Error responses:**
```typescript
// 400 — Bad request (validation)
{ error: "name, email, and password are required" }

// 401 — Not authenticated
{ error: "Authentication required" }
{ error: "Invalid email or password" }

// 403 — Not authorized
{ error: "Insufficient permissions" }

// 404 — Not found
{ error: "Submission not found" }

// 409 — Conflict
{ error: "Email already in use" }

// 500 — Server error
{ error: "Internal server error" }
```

### 13. File Upload Handling

**Upload Middleware (`src/middleware/upload.middleware.ts`):**
```typescript
import multer from "multer";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

const ALLOWED_MIME_TYPES = [
  "video/webm",
  "video/mp4",
  "video/ogg",
];

export const videoUpload = multer({
  storage: multer.memoryStorage(), // hold in memory before S3 upload
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});
```

**Storage Service (`src/service/storage.service.ts`):**
```typescript
// Abstract S3/R2 client — implementation depends on chosen provider
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ key: string; bucket: string; sizeBytes: number }> {
  // Upload to S3/R2
  // Return metadata
}

export async function getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
  // Generate pre-signed URL for video playback/download
}

export function generateStorageKey(
  submissionId: string,
  questionId: string
): string {
  return `submissions/${submissionId}/answers/${questionId}.webm`;
}
```

### 14. Error Handling & Edge Cases

- **Duplicate email on register:** Check `findUnique({ where: { email } })` before create, return 409
- **Wrong password on login:** Return generic "Invalid email or password" (don't reveal which is wrong)
- **Expired JWT:** Return 401, frontend redirects to login
- **Missing req.user after verifyToken:** This shouldn't happen — if it does, it's a bug (500)
- **Video upload too large:** Multer rejects with `LIMIT_FILE_SIZE`, return 413
- **Video upload wrong type:** Multer rejects, return 400 with supported types
- **Submission not found / not owned by user:** Return 404 (don't reveal existence to unauthorized users)
- **Examiner tries to score already-scored answer:** Unique constraint violation, return 409
- **Payment webhook replay:** Check if payment already PAID, return 200 (idempotent)
- **Database connection failure on startup:** Log error and exit(1) — don't start server without DB

### 15. Security Checklist

- [ ] All passwords hashed with bcryptjs (10 salt rounds)
- [ ] `bcrypt.compare()` always awaited (critical: missing await = always truthy)
- [ ] `password` field never returned in API responses (use Prisma `select`)
- [ ] JWT secret stored in environment variable only
- [ ] httpOnly cookies with `secure: true` in production
- [ ] CORS restricted to frontend origin with credentials
- [ ] All routes except `/api/auth/register` and `/api/auth/login` protected by `verifyToken`
- [ ] Role-based routes additionally protected by `requireRole()`
- [ ] File upload size limited (500MB max)
- [ ] File upload MIME type validated
- [ ] Prisma queries use parameterized inputs (automatic)
- [ ] Request body validated before database operations
- [ ] Global error handler catches unhandled exceptions
- [ ] Graceful shutdown disconnects PrismaClient

### 16. TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Key points:**
- ES Modules (`"type": "module"` in package.json)
- All imports must include `.js` extension (NodeNext requirement)
- Strict mode enabled — no implicit `any`, strict null checks
- `rootDir: "src"` — all source files must be inside `src/`

---

## Implementation Order (suggested)

1. **Foundation**: Environment config, database connection, server entry point
2. **Auth**: JWT utilities, auth middleware, auth service, auth controller, auth routes
3. **Questions**: Question CRUD routes (needed before submissions can reference them)
4. **Submissions**: Submission lifecycle (start, list, detail, complete)
5. **Answers**: Video upload with Multer + S3/R2 storage
6. **Payments**: Payment creation, webhook handling, status updates
7. **Examiner**: Assignment creation, score submission, work queue
8. **Results**: Score aggregation, result detail, certificate generation
9. **Admin**: User management, examiner assignment, dashboard stats
10. **Security and polish**: Verified route-boundary rate limiting, error handling refinements, logging, API documentation

---

## Notes

- Use `tsx` for development hot-reload (`nodemon --watch src --exec tsx src/server.ts`)
- Use `tsc` for production build (outputs to `dist/`, run with `node dist/server.js`)
- Prisma migrations: always create new migrations, never modify existing ones
- Prisma generate: run after every schema change (`npx prisma generate`)
- The `prisma-client` generator (not `prisma-client-js`) outputs TypeScript source to `src/generated/`
- Import Prisma types from `../generated/client.js` and `../generated/enums.js`
- All IDs are UUIDs (generated by PostgreSQL `gen_random_uuid()` via Prisma `@default(uuid())`)
- Payment amounts stored as integers (minor units: rupiah/cents) — never float
- Scores stored as `Decimal(5,2)` — validated 0–100 at application level
- Soft deletes (`deletedAt`) used for User and Question — all queries should filter `deletedAt: null`
