"use client";

import { useRef, useState, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";
import {
  getQuestionAudioPresignedUrl,
  confirmQuestionAudioUpload,
  uploadToR2,
} from "@/lib/question-audio-api";

type UploadState = "idle" | "getting-url" | "uploading" | "uploaded" | "error";

const ACCEPTED = "audio/webm,audio/mpeg,audio/mp4,audio/ogg,audio/m4a,.webm,.mp3,.mp4,.ogg,.m4a";

/**
 * Admin control for uploading a question's prompt audio:
 * pick a file → presigned PUT → R2 → confirm. Fires `onUploaded` when
 * the backend has marked the question UPLOADED.
 */
export function AudioUploadButton({
  questionId,
  disabled,
  onUploaded,
}: {
  questionId: string;
  disabled?: boolean;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  async function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setState("getting-url");
    try {
      const mimeType = file.type || "audio/webm";
      const { presignedUrl } = await getQuestionAudioPresignedUrl(questionId, mimeType);
      setState("uploading");
      await uploadToR2(presignedUrl, file);
      await confirmQuestionAudioUpload(questionId);
      setState("uploaded");
      onUploaded();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed";
      setError(message);
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handlePick}
        disabled={disabled}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || state === "getting-url" || state === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {state === "getting-url" || state === "uploading" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {state === "getting-url" ? "Preparing upload…" : "Uploading…"}
            </>
          ) : (
            "Upload audio"
          )}
        </Button>
        {state === "uploaded" && (
          <span className="text-xs font-medium text-ink">Audio uploaded</span>
        )}
        {fileName && (state === "idle" || state === "error") && (
          <span className="font-mono text-xs text-ink-soft">{fileName}</span>
        )}
      </div>
      {error && (
        <Alert variant="destructive" className="items-start py-2">
          <TriangleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
