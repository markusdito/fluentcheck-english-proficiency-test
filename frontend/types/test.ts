import type { QuestionCategory } from "@/lib/assessment-slots";

export type { QuestionCategory };

/** The Test Set a Submission was delivered from; null for legacy Submissions. */
export interface TestSetRef {
  id: string;
  code: string;
}

/** Part 2 cue card (PRD §3.2): a topic and exactly three points to include. */
export interface CueCard {
  topic: string;
  points: string[];
}

/** One of the four Part 3 options as delivered: always text, with its icon. */
export interface DeliveredOption {
  title: string;
  bullets: string[];
  iconUrl: string | null;
}

export interface ApiTask {
  id: string;
  promptText: string;
  order: number;
}

export type QuestionAudioStatus = "PENDING" | "UPLOADED" | "FAILED";

export interface ApiQuestion {
  id: string;
  category: QuestionCategory;
  testSetId: string;
  preparationSeconds: number;
  recordingSeconds: number;
  audioStorageKey: string | null;
  audioUploadStatus: QuestionAudioStatus;
  tasks: ApiTask[];
}

export interface TestQuestionWithAudio {
  id: string;
  category: QuestionCategory;
  testSetId: string;
  preparationSeconds: number;
  recordingSeconds: number;
  audioUploadStatus: QuestionAudioStatus;
  audioUrl: string | null;
  tasks: ApiTask[];
}

export interface Prompt {
  id: string;
  category: QuestionCategory;
  audioUrl: string | null;
  tasks: string[];
  task: string; // backward-compatible convenience — joined tasks
  prepTime: number;
  recordingDuration: number;
  order: number;
  cueCard: CueCard | null;
  options: DeliveredOption[] | null;
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
  status: "in_progress" | "completed" | "expired";
  currentSection: number;
  currentPrompt: number;
  startedAt: string;
}

export interface Recording {
  id: string;
  promptId: string;
  status: "pending" | "uploaded" | "failed";
  duration: number;
}

/** Upload status for each question's video */
export type UploadStatus =
  | "idle"
  | "finalizing"
  | "blob-ready"
  | "signing"
  | "getting-url" // retained for older consumers
  | "uploading"
  | "verifying"
  | "uploaded"
  | "error";

export interface QuestionUploadState {
  status: UploadStatus;
  error?: string;
}
