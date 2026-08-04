export interface ApiTask {
  id: string;
  promptText: string;
  order: number;
}

export type QuestionAudioStatus = "PENDING" | "UPLOADED" | "FAILED";

export interface ApiQuestion {
  id: string;
  category: "PART_1" | "PART_2" | "PART_3";
  order: number;
  preparationSeconds: number;
  recordingSeconds: number;
  audioStorageKey: string | null;
  audioUploadStatus: QuestionAudioStatus;
  tasks: ApiTask[];
}

export interface Prompt {
  id: string;
  audioUrl: string | null;
  tasks: string[];
  task: string; // backward-compatible convenience — joined tasks
  prepTime: number;
  recordingDuration: number;
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
export type UploadStatus = "idle" | "getting-url" | "uploading" | "uploaded" | "error";

export interface QuestionUploadState {
  status: UploadStatus;
  error?: string;
}
