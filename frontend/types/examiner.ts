export interface ExaminerTask {
  id: string;
  promptText: string;
  order: number;
}

export interface ExaminerAssignmentSummary {
  id: string;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentAnswer {
  id: string;
  questionId: string;
  questionCategory: string;
  audioUrl: string | null;
  tasks: ExaminerTask[];
  durationSeconds: number | null;
  videoUrl: string | null;
}

export interface AssignmentDetail {
  id: string;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  answers: AssignmentAnswer[];
  createdAt: string;
  updatedAt: string;
}
