"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SessionUser } from "@/types/auth";

interface SessionResponse {
  status: string;
  data: { user: SessionUser };
}

export async function fetchSession(
  signal?: AbortSignal,
): Promise<SessionUser | null> {
  try {
    const response = await api.get<SessionResponse>("/auth/me", {
      redirectOn401: false,
      signal,
    });
    return response.data.user;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) return null;
    throw error;
  }
}

export function useSession(options: { required?: boolean } = {}) {
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (options.required && query.data === null) {
      window.location.href = "/login";
    }
  }, [options.required, query.data]);

  return query;
}
