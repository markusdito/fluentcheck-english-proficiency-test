export const queryKeys = {
  session: ["session"] as const,
  studentDashboard: ["dashboard", "student"] as const,
  examinerAssignments: ["assignments", "examiner"] as const,
  examinerAssignment: (assignmentId: string) =>
    ["assignments", "examiner", assignmentId] as const,
  submissionDetail: (submissionId: string) =>
    ["submissions", "detail", submissionId] as const,
  submissionStatus: (submissionId: string) =>
    ["submissions", "status", submissionId] as const,
  adminStats: ["admin", "stats"] as const,
  adminUsers: (params: { page: number; role?: string; q?: string }) =>
    ["admin", "users", params] as const,
  roleTransitionPreview: (userId: string, role: string) =>
    ["admin", "role-transition-preview", userId, role] as const,
  adminSubmissions: (params: { page: number; limit: number; status?: string }) =>
    ["admin", "submissions", params] as const,
  adminSubmission: (submissionId: string) =>
    ["admin", "submissions", "detail", submissionId] as const,
  adminQuestions: ["admin", "questions"] as const,
  adminSettings: ["admin", "settings"] as const,
} as const;
