import { api } from "./api";
import { clearAssessmentStartIntent } from "./assessment-start-intent";
import type { QueryClient } from "@tanstack/react-query";

export async function signOut(queryClient?: QueryClient) {
  try {
    await api.post("/auth/logout");
  } finally {
    clearAssessmentStartIntent();
    queryClient?.clear();
    window.location.href = "/";
  }
}
