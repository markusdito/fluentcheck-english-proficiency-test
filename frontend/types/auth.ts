export type SessionRole = "STUDENT" | "EXAMINER" | "ADMIN";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  createdAt: string;
  /** PRD FR-1.4: spoken in the system-check identity clip. Absent on older backends. */
  fullName?: string | null;
  studentNumber?: string | null;
}

export type User = SessionUser;

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  targetScore?: number;
}

export interface AuthResponse {
  user: SessionUser;
}
