export interface Prompt {
  id: string;
  text: string;
  task: string;
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