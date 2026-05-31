# FluentCheck

A comprehensive English proficiency assessment platform with secure authentication, timed tests, webcam recording, automated evaluation, and detailed score reporting.

## Tech Stack

### Frontend

- Next.js 16 with the App Router
- React 19
- TypeScript 5
- Tailwind CSS 4
- ESLint 9 with the Next.js config

### Backend

- Node.js with TypeScript 6
- Express 5
- Prisma 6 ORM and Prisma Client
- PostgreSQL
- dotenv for environment configuration
- CORS middleware

### Tooling

- npm with `package-lock.json`
- ts-node-dev for TypeScript backend development
- Prisma migrations configured under `backend/prisma/migrations`

## Project Structure

```text
.
|-- backend/   # Express, Prisma, PostgreSQL configuration
|-- frontend/  # Next.js app
`-- docs/      # Project documentation
```

## Environment Variables

The backend reads environment values from `backend/.env` through `dotenv`.

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
JWT_SECRET="your-secret-key"
```

## Local Development

Install dependencies separately for each app:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Run the frontend development server:

```bash
cd frontend
npm run dev
```

The frontend runs on `http://localhost:3000` by default.

Prepare Prisma after configuring `DATABASE_URL`:

```bash
cd backend
npx prisma generate
npx prisma migrate dev
```

## Available Commands

Frontend:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

Backend:

```bash
npx prisma generate
npx prisma migrate dev
```

There is not currently a backend `dev` or `start` script configured in `backend/package.json`.
