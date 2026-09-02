"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useMediaDevices, type UseMediaDevicesReturn } from "@/hooks/useMediaDevices";
import { useSession } from "@/hooks/useSession";
import type { SessionUser } from "@/types/auth";

export interface AssessmentStartContextValue extends UseMediaDevicesReturn {
  studentId: string | null;
  sessionPending: boolean;
  sessionError: unknown;
  student: SessionUser | null;
}

export const AssessmentStartContext = createContext<AssessmentStartContextValue | null>(null);

export function AssessmentStartProvider({ children }: { children: React.ReactNode }) {
  const media = useMediaDevices();
  const session = useSession();
  const previousStudentIdRef = useRef<string | null | undefined>(undefined);
  const studentId = session.data?.id ?? null;
  const { stopStream } = media;

  useEffect(() => {
    if (
      previousStudentIdRef.current !== undefined &&
      previousStudentIdRef.current !== studentId
    ) {
      stopStream();
    }
    previousStudentIdRef.current = studentId;
  }, [stopStream, studentId]);

  const value = useMemo<AssessmentStartContextValue>(
    () => ({
      ...media,
      studentId,
      sessionPending: session.isPending,
      sessionError: session.error,
      student: session.data ?? null,
    }),
    [media, session.data, session.error, session.isPending, studentId],
  );

  return (
    <AssessmentStartContext.Provider value={value}>
      {children}
    </AssessmentStartContext.Provider>
  );
}

export function useAssessmentStart(): AssessmentStartContextValue {
  const context = useContext(AssessmentStartContext);
  if (!context) {
    throw new Error("useAssessmentStart must be used within AssessmentStartProvider");
  }
  return context;
}
