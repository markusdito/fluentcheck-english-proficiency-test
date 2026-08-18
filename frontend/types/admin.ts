export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface AdminExaminer {
  id: string;
  username: string;
  email: string;
  openAssignments: number;
}

export interface AdminPaymentSummary {
  status: string;
  amount: number;
  currency: string;
  paidAt: string | null;
}

export interface AdminAssignmentSummary {
  id: string;
  status: string;
  examinerName: string;
}

export interface AdminSubmission {
  id: string;
  status: string;
  paymentRequired: boolean;
  studentName: string;
  studentEmail: string;
  createdAt: string;
  latestPayment: AdminPaymentSummary | null;
  assignments: AdminAssignmentSummary[];
}

export interface AdminSubmissionPayment extends AdminPaymentSummary {
  id: string;
  provider: string | null;
  providerRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSubmissionAssignment {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  examiner: {
    id: string;
    name: string;
    email: string;
  };
}

export interface AdminAnswerScore {
  id: string;
  assignmentId: string;
  examinerId: string;
  examinerName: string;
  value: number;
  comment: string | null;
}

export interface AdminSubmissionAnswer {
  id: string;
  questionId: string;
  questionCategory: string;
  tasks: AdminTask[];
  audioUrl: string | null;
  durationSeconds: number | null;
  uploadStatus: string;
  videoUrl: string | null;
  score: number | null;
  comments: string[];
  scores: AdminAnswerScore[];
}

export interface AdminSubmissionDetail {
  id: string;
  status: string;
  paymentRequired: boolean;
  createdAt: string;
  updatedAt: string;
  student: {
    id: string;
    name: string;
    email: string;
  };
  score: string | null;
  certificate: {
    finalScore: string;
    issuedAt: string;
  } | null;
  payments: AdminSubmissionPayment[];
  assignments: AdminSubmissionAssignment[];
  answers: AdminSubmissionAnswer[];
}

export interface AdminStats {
  usersByRole: Record<string, number>;
  submissionsByStatus: Record<string, number>;
  paidRevenue: number;
  pendingGrading: number;
  recentSubmissions: Array<{
    id: string;
    status: string;
    createdAt: string;
    studentName?: string;
  }>;
}

export interface AdminSettings {
  paymentEnabled: boolean;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminTask {
  id: string;
  promptText: string;
  order: number;
}

export interface AdminQuestion {
  id: string;
  category: string;
  order: number;
  preparationSeconds: number;
  recordingSeconds: number;
  audioStorageKey: string | null;
  audioMimeType: string | null;
  audioSizeBytes: number | null;
  audioUploadStatus: "PENDING" | "UPLOADED" | "FAILED";
  createdAt: string;
  tasks: AdminTask[];
}
