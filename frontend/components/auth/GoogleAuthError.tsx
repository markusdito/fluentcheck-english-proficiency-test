"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
    <Alert variant="destructive" className="mb-6 items-start">
      <CircleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
