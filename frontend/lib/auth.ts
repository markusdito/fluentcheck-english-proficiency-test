import { api } from "./api";
import type { QueryClient } from "@tanstack/react-query";

export async function signOut(queryClient?: QueryClient) {
  try {
    await api.post("/auth/logout");
  } finally {
    queryClient?.clear();
    window.location.href = "/";
  }
}
