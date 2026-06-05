# Product Requirements Document (PRD): FluentCheck English Proficiency Test
Version: 1.0.0

## 1. Project Overview
FluentCheck is an English proficiency assessment platform that evaluates users' speaking skills through structured video responses reviewed by an expert jury. The platform aims to provide a seamless experience for users to record their responses via webcam and receive professional feedback on their proficiency.

## 2. Target Audience
*   Non-native English speakers preparing for standardized tests (IELTS, TOEFL, etc.).
*   Job seekers looking to validate their English communication skills.
*   Language learners seeking quantitative feedback on their progress.

## 3. Key Features

### 3.1. User Authentication
*   Secure registration and login functionality.
*   User profile management (name, target score, test history).
*   Integration with existing Express.js/Prisma backend.

### 3.2. Assessment Interface
*   Display of test prompts (textual or audio-based).
*   Preparation timer for each prompt.
*   Structured test flow (multiple sections covering different speaking tasks).

### 3.3. Webcam Integration & Recording
*   Real-time webcam preview.
*   Recording indicator and countdown timer.
*   Automatic or manual upload of recorded footage.
*   MediaRecorder API integration for high-performance recording in the browser.

### 3.4. Results & Feedback
*   Dashboard to view completed tests.
*   Detailed assessment scores provided by an expert jury.
*   Feedback on pronunciation, fluency, and vocabulary.

## 4. Technical Stack

### 4.1. Frontend
*   **Framework**: Next.js (TypeScript)
*   **Styling**: Tailwind CSS
*   **Video Handling**: MediaRecorder API
*   **State Management**: React Context or local state for test flows.

### 4.2. Backend
*   **Framework**: Express.js (Node.js)
*   **ORM**: Prisma
*   **Database**: PostgreSQL
*   **Authentication**: JWT (JSON Web Tokens) with Bcrypt for password hashing.

### 4.3. Storage
*   **Video Storage**: Cloud storage solution (e.g., AWS S3, Google Cloud Storage, or Cloudinary).
*   **Metadata**: Stored in the primary database via Prisma.

## 5. User Journey
1.  **Landing**: User arrives and logs in or signs up.
2.  **Dashboard**: User views history and clicks "Start New Test".
3.  **Hardware Check**: System verifies webcam and microphone access.
4.  **Testing**: User goes through a series of prompts, recording video for each.
5.  **Submission**: System uploads videos in the background.
6.  **Results**: User is notified when results are ready and views them on the dashboard.

## 6. Success Metrics
*   Successful upload rate of video recordings > 99%.
*   Average test completion time < 20 minutes.
*   User retention and improvement in scores over time.
