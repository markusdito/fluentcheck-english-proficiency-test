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
  studentName: string;
  studentEmail: string;
  createdAt: string;
  latestPayment: AdminPaymentSummary | null;
  assignments: AdminAssignmentSummary[];
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
