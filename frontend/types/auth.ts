export type SessionRole = "STUDENT" | "EXAMINER" | "ADMIN";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  createdAt: string;
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
