export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface AccountTransitionCandidate {
  id: string;
  username: string;
  email: string;
}

export interface AccountTransitionAssignmentImpact {
  id: string;
  submissionId: string;
  slot: number;
  status: string;
  createdAt: string;
  currentExaminer: AccountTransitionCandidate;
  scoreCount: number;
  transferEligible: boolean;
  candidates: AccountTransitionCandidate[];
}

export interface AccountTransitionPreview {
  user: AdminUser & { deletedAt: string | null };
  requestedRole: string;
  assignments: AccountTransitionAssignmentImpact[];
}

export interface AccountTransitionAssignmentSummary {
  id: string;
  submissionId: string;
  slot: number;
  status: string;
  previousExaminerId: string;
  newExaminerId: string;
  scoreCount: number;
  createdAt: string;
}

export interface AccountTransitionResult {
  outcome: "UPDATED" | "ALREADY_APPLIED";
  user: AdminUser & { deletedAt: string | null };
  assignments: AccountTransitionAssignmentSummary[];
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

export interface AssignSubmissionResult {
  submissionId: string;
  status: string;
  outcome: "CREATED" | "EXISTING";
  assignments: AdminAssignmentSummary[];
  assignedExaminers: Array<{
    id: string;
    name: string;
    email: string;
  }>;
}

export interface AdminSubmission {
  id: string;
  status: string;
  paymentRequired: boolean;
  testSet: TestSetRef | null;
  studentName: string;
  studentEmail: string;
  createdAt: string;
  latestPayment: AdminPaymentSummary | null;
  assignments: AdminAssignmentSummary[];
}

export interface AdminSubmissionPayment extends AdminPaymentSummary {
  id: string;
  provider: string | null;
  merchantReference: string | null;
  providerSessionId: string | null;
  providerTransactionId: string | null;
  legacyProviderRef: string | null;
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
  /** Untouched ASSIGNED work an Admin may move to another Examiner. Absent on older backends. */
  reassignable?: boolean;
  /** Every move of this assignment between Examiners, oldest first. */
  reassignmentHistory?: AdminReassignmentEntry[];
  /** This Examiner's whole-Submission Score (admin-only). */
  score: {
    value: number;
    rubric: RubricValues | null;
    comment: string | null;
  } | null;
}

export interface AdminReassignmentEntry {
  id: string;
  /** ACCOUNT_ROLE_TRANSITION, ACCOUNT_DEACTIVATION or ADMIN_REASSIGNMENT */
  reason: string;
  note: string | null;
  createdAt: string;
  previousExaminerName: string;
  newExaminerName: string;
  actingAdminName: string;
}

export interface AdminSubmissionPaymentWaiver {
  reason: string;
  createdAt: string;
  adminName: string;
}

export interface AdminAnswerScore {
  id: string;
  assignmentId: string;
  examinerId: string;
  examinerName: string;
  value: number;
  rubric: RubricBreakdown | null;
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
  rubric: RubricBreakdown | null;
  comments: string[];
  scores: AdminAnswerScore[];
}

export interface AdminSubmissionDetail {
  id: string;
  status: string;
  scoringSystem: ScoringSystem;
  paymentRequired: boolean;
  testSet: TestSetRef | null;
  createdAt: string;
  updatedAt: string;
  student: {
    id: string;
    name: string;
    email: string;
  };
  score: string | null;
  rubric: RubricBreakdown | null;
  certificate: {
    finalScore: string;
    issuedAt: string;
  } | null;
  payments: AdminSubmissionPayment[];
  /** Flag audit trail. Absent on older backends. */
  flags?: AdminSubmissionFlag[];
  retakeCredit?: { redeemedSubmissionId: string | null; redeemedAt: string | null } | null;
  waivedByRetakeCreditFrom?: string | null;
  /** An Admin's audited payment waiver. Absent on older backends. */
  paymentWaiver?: AdminSubmissionPaymentWaiver | null;
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
  /** Omitted by older active-only responses; a non-null value means retired. */
  deletedAt?: string | null;
}

export interface AdminOption {
  title: string;
  bullets: string[];
  /** Verified icon identity; null until an icon is uploaded for this option. */
  icon: { storageKey: string; mimeType: string; sizeBytes: number } | null;
  /** Short-lived preview URL for the icon. */
  iconUrl?: string | null;
}

export interface AdminQuestion {
  id: string;
  category: string;
  testSetId: string;
  testSet: TestSetRef;
  preparationSeconds: number;
  recordingSeconds: number;
  cueCard?: CueCard | null;
  options?: AdminOption[] | null;
  audioStorageKey: string | null;
  audioMimeType: string | null;
  audioSizeBytes: number | null;
  audioUploadStatus: "PENDING" | "UPLOADED" | "FAILED";
  createdAt: string;
  /** Omitted by older active-only responses; a non-null value means retired. */
  deletedAt?: string | null;
  tasks: AdminTask[];
}
import type {
  RubricBreakdown,
  RubricValues,
  ScoringSystem,
} from "@/types/scoring";
import type { CueCard, QuestionCategory, TestSetRef } from "@/types/test";

export interface AdminTestSetSlot {
  category: QuestionCategory;
  questionId: string | null;
  eligible: boolean;
}

/** A Test Set is deliverable only when every slot holds an Eligible question. */
export interface AdminTestSet {
  id: string;
  code: string;
  status: "DELIVERABLE" | "DRAFT";
  slots: AdminTestSetSlot[];
  createdAt: string;
}

export type FlagType = "TECHNICAL_FAILURE" | "CAMERA_DROP" | "INTEGRITY_CONCERN";

export interface AdminSubmissionFlag {
  id: string;
  type: FlagType;
  source: "STUDENT_DEVICE" | "EXAMINER";
  reason: string;
  timestampSeconds: number | null;
  raisedAt: string;
  raisedBy: string | null;
  resolution: "CONFIRMED" | "DISMISSED" | "SUPERSEDED" | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** An open flag in the Admin review queue, with its Answer video as evidence. */
export interface AdminOpenFlag {
  id: string;
  submissionId: string;
  type: FlagType;
  source: "STUDENT_DEVICE" | "EXAMINER";
  reason: string;
  timestampSeconds: number | null;
  raisedAt: string;
  raisedBy: string | null;
  slot: string | null;
  studentName: string;
  studentEmail: string;
  submissionCreatedAt: string;
  videoUrl: string | null;
}

export type PaymentReconciliationReason =
  | "CHECKOUT_UNCONFIRMED"
  | "NO_PROVIDER_OUTCOME"
  | "DUPLICATE_PAYMENT"
  | "PAID_WHILE_WAIVED";

export interface AdminQueue<T> {
  total: number;
  items: T[];
}

/** Dashboard review queues, oldest items first. */
export interface AdminQueues {
  openFlags: AdminQueue<{
    id: string;
    submissionId: string;
    type: FlagType;
    source: "STUDENT_DEVICE" | "EXAMINER";
    reason: string;
    raisedAt: string;
    studentName: string;
  }>;
  paymentReconciliation: AdminQueue<{
    reason: PaymentReconciliationReason;
    paymentId: string;
    submissionId: string;
    submissionStatus: string;
    studentName: string;
    paymentStatus: string;
    amount: number;
    currency: string;
    merchantReference: string | null;
    providerSessionId: string | null;
    providerTransactionId: string | null;
    createdAt: string;
    paidAt: string | null;
  }>;
  assignmentReady: AdminQueue<{
    submissionId: string;
    studentName: string;
    paymentWaived: boolean;
    paymentRequired: boolean;
    createdAt: string;
    readySince: string;
  }>;
}
