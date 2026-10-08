"use client";

import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { btnSecondary, error as errorText, field, label } from "@/components/admin/styles";
import { ApiError } from "@/lib/api";
import { updateQuestion, uploadOptionIcon } from "@/lib/admin-api";
import type { AdminOption, AdminQuestion } from "@/types/admin";

const ICON_ACCEPT = "image/png,image/jpeg,image/webp";

function message(err: unknown, fallback: string) {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

function TextInput({ id, text, value, onChange, disabled }: {
  id: string;
  text: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className={label}>
      <span>{text}</span>
      <input id={id} className={field} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Part 2 cue card: topic + exactly three points. */
function CueCardEditor({ question, onSaved, disabled }: {
  question: AdminQuestion;
  onSaved: (question: AdminQuestion) => void;
  disabled?: boolean;
}) {
  const [topic, setTopic] = useState(question.cueCard?.topic ?? "");
  const [points, setPoints] = useState(question.cueCard?.points ?? ["", "", ""]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    if (!topic.trim() || points.some((point) => !point.trim())) {
      setError("The cue card needs a topic and all three points.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await updateQuestion(question.id, { cueCard: { topic: topic.trim(), points: points.map((p) => p.trim()) } }));
    } catch (err) {
      setError(message(err, "Failed to save the cue card."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-sn-border bg-sn-bg p-4 sm:p-5">
      <p className="mb-1 text-[15px] font-semibold">Cue card</p>
      <p className="mb-3 text-sm text-sn-muted">Shown to the student during Part 2: the talk topic and three points to include.</p>
      {error && <p role="alert" className={`${errorText} mb-3`}>{error}</p>}
      <div className="grid gap-3">
        <TextInput id="cue-card-topic" text="Topic" value={topic} onChange={setTopic} disabled={disabled || saving} />
        {points.map((point, index) => (
          <TextInput
            key={index}
            id={`cue-card-point-${index}`}
            text={`Point ${index + 1}`}
            value={point}
            onChange={(value) => setPoints(points.map((p, i) => (i === index ? value : p)))}
            disabled={disabled || saving}
          />
        ))}
        <div className="flex justify-end">
          <Button type="button" className={btnSecondary} loading={saving} disabled={disabled} onClick={() => void save()}>
            Save cue card
          </Button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_OPTIONS: AdminOption[] = Array.from({ length: 4 }, () => ({ title: "", bullets: ["", ""], icon: null }));

/** Part 3 options: four × (title + two bullets + icon). Icons upload once the texts are saved. */
function OptionsEditor({ question, onSaved, disabled }: {
  question: AdminQuestion;
  onSaved: (question: AdminQuestion) => void;
  disabled?: boolean;
}) {
  const saved = question.options?.length === 4 ? question.options : null;
  const [options, setOptions] = useState<AdminOption[]>(saved ?? EMPTY_OPTIONS);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);

  function edit(index: number, patch: Partial<AdminOption>) {
    setOptions(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  }

  async function save() {
    setError("");
    if (options.some((option) => !option.title.trim() || option.bullets.some((bullet) => !bullet.trim()))) {
      setError("Each of the four options needs a title and two bullets.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateQuestion(question.id, {
        options: options.map((option) => ({
          title: option.title.trim(),
          bullets: option.bullets.map((bullet) => bullet.trim()),
        })),
      });
      setOptions(updated.options ?? options);
      onSaved(updated);
    } catch (err) {
      setError(message(err, "Failed to save the options."));
    } finally {
      setSaving(false);
    }
  }

  async function handleIcon(index: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setUploading(index);
    try {
      await uploadOptionIcon(question.id, index, file);
      // Reload the question so the icon identity and preview come from the server.
      const updated = await updateQuestion(question.id, {});
      setOptions((current) => current.map((option, i) => ({ ...option, icon: updated.options?.[i]?.icon ?? null, iconUrl: updated.options?.[i]?.iconUrl })));
      onSaved(updated);
    } catch (err) {
      setError(message(err, "Failed to upload the icon."));
    } finally {
      setUploading(null);
    }
  }

  const missingIcons = options.filter((option) => !option.icon).length;

  return (
    <div className="rounded-2xl border border-sn-border bg-sn-bg p-4 sm:p-5">
      <p className="mb-1 text-[15px] font-semibold">Options</p>
      <p className="mb-3 text-sm text-sn-muted">
        The student chooses ONE of four options. Each option is shown as text with its icon.
        {missingIcons > 0 && ` This question is not deliverable until all four icons are uploaded (${missingIcons} missing).`}
      </p>
      {error && <p role="alert" className={`${errorText} mb-3`}>{error}</p>}
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {options.map((option, index) => (
          <li key={index} className="grid gap-3 rounded-xl border border-sn-border bg-sn-surface p-3">
            <p className="m-0 text-sm font-semibold">Option {index + 1}</p>
            <TextInput id={`option-${index}-title`} text="Title" value={option.title} onChange={(title) => edit(index, { title })} disabled={disabled || saving} />
            {option.bullets.map((bullet, bulletIndex) => (
              <TextInput
                key={bulletIndex}
                id={`option-${index}-bullet-${bulletIndex}`}
                text={`Bullet ${bulletIndex + 1}`}
                value={bullet}
                onChange={(value) => edit(index, { bullets: option.bullets.map((b, i) => (i === bulletIndex ? value : b)) })}
                disabled={disabled || saving}
              />
            ))}
            <div className="flex items-center gap-3">
              {option.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={option.iconUrl} alt={`Option ${index + 1} icon`} className="size-10 object-contain" />
              ) : (
                <span className="text-xs text-sn-clay">No icon</span>
              )}
              <label className={`${btnSecondary} cursor-pointer ${!saved || disabled ? "pointer-events-none opacity-50" : ""}`}>
                {uploading === index ? "Uploading…" : option.icon ? "Replace icon" : "Upload icon"}
                <input
                  type="file"
                  accept={ICON_ACCEPT}
                  className="sr-only"
                  aria-label={`Option ${index + 1} icon`}
                  disabled={!saved || disabled || uploading !== null}
                  onChange={(e) => void handleIcon(index, e)}
                />
              </label>
            </div>
          </li>
        ))}
      </ol>
      {!saved && <p className="mt-3 text-xs text-sn-muted">Save the four options before uploading icons.</p>}
      <div className="mt-3 flex justify-end">
        <Button type="button" className={btnSecondary} loading={saving} disabled={disabled} onClick={() => void save()}>
          Save options
        </Button>
      </div>
    </div>
  );
}

/** Structured onscreen content for the slots that have it (PRD §3.2); Parts 1 and 4 use tasks only. */
export function QuestionContentEditor({ question, onSaved, disabled }: {
  question: AdminQuestion;
  onSaved: (question: AdminQuestion) => void;
  disabled?: boolean;
}) {
  if (question.category === "PART_2") return <CueCardEditor question={question} onSaved={onSaved} disabled={disabled} />;
  if (question.category === "PART_3") return <OptionsEditor question={question} onSaved={onSaved} disabled={disabled} />;
  return null;
}
