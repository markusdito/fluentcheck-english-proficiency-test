"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { errorSummary } from "@/components/auth/styles";
import {
  getGoogleAuthErrorMessage,
  removeGoogleAuthErrorFromUrl,
} from "@/lib/google-auth";

export function GoogleAuthError() {
  const searchParams = useSearchParams();
  const [message] = useState(() =>
    getGoogleAuthErrorMessage(searchParams.get("google_error")),
  );

  useEffect(() => {
    removeGoogleAuthErrorFromUrl();
  }, []);

  if (!message) return null;

  return (
    <p role="alert" className={`mb-6 ${errorSummary}`}>
      {message}
    </p>
  );
}
