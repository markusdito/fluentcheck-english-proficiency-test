"use client";

import { useState, FormEvent, KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  fetchAdminQuestions,
  createQuestion,
  updateQuestion,
  retireQuestion,
  restoreQuestion,
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
} from "@/lib/admin-api";
import type { AdminQuestion, AdminTask } from "@/types/admin";
import { queryKeys } from "@/lib/query-keys";
import { parseNonNegativeInteger } from "@/lib/question-form";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Pill } from "@/components/student/StatusPill";
import { card, h2, h3, meta, primaryButton } from "@/components/student/styles";
import { btnDanger, btnPrimary, btnSecondary, chip, empty, error as errorText, field, label, lead } from "@/components/admin/styles";
import { AudioUploadButton } from "@/components/admin/AudioUploadButton";
import { AudioUploadBadge } from "@/components/admin/AudioUploadBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CATEGORIES = ["PART_1", "PART_2", "PART_3"] as const;

const categoryLabels: Record<string, string> = {
  PART_1: "Part 1",
  PART_2: "Part 2",
  PART_3: "Part 3",
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <Pill>{categoryLabels[category] ?? category}</Pill>
  );
}

function LifecycleBadge({
  entity,
  retired,
}: {
  entity: "Question" | "Task";
  retired: boolean;
}) {
  return (
    <span aria-label={`${entity} ${retired ? "retired" : "active"}`}>
      <Pill tone={retired ? "clay" : "green"}>{retired ? "Retired" : "Active"}</Pill>
    </span>
  );
}

function isRetired(record: { deletedAt?: string | null }) {
  return record.deletedAt != null;
}

function Field({
  label: text,
  helperText,
  required,
  id,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; helperText?: string; id: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>
        <span>
          {text}
          {required && <span className="ml-0.5 text-sn-clay">*</span>}
        </span>
        <input
          id={id}
          required={required}
          aria-describedby={helperText ? `${id}-help` : undefined}
          className={field}
          {...rest}
        />
      </label>
      {helperText && (
        <p id={`${id}-help`} className="mt-1.5 text-[13px] text-sn-muted">{helperText}</p>
      )}
    </div>
  );
}

function ToNumberInput({
  value,
  onChange,
  id,
  label,
  required,
  disabled,
  helperText,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
}) {
  return (
    <Field
      id={id}
      label={label}
      type="number"
      min={0}
      step={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      helperText={helperText}
    />
  );
}

function QuestionFormFields({
  idPrefix,
  category,
  onCategory,
  order,
  onOrder,
  preparationSeconds,
  onPreparationSeconds,
  recordingSeconds,
  onRecordingSeconds,
  disabled,
}: {
  idPrefix: string;
  category: string;
  onCategory: (v: string) => void;
  order: string;
  onOrder: (v: string) => void;
  preparationSeconds: string;
  onPreparationSeconds: (v: string) => void;
  recordingSeconds: string;
  onRecordingSeconds: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <label className={label}>
        <span>
          Category <span className="text-sn-clay">*</span>
        </span>
        <select
          className={field}
          value={category}
          onChange={(e) => onCategory(e.target.value)}
          disabled={disabled}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabels[c]}</option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <ToNumberInput
          id={`${idPrefix}-order`}
          label="Order"
          value={order}
          onChange={onOrder}
          required
          disabled={disabled}
          helperText="Question set shared by all categories: a test uses one order in PART_1, PART_2 and PART_3 together, so each delivered order must exist in every category."
        />
        <ToNumberInput
          id={`${idPrefix}-preparationSeconds`}
          label="Prep (s)"
          value={preparationSeconds}
          onChange={onPreparationSeconds}
          disabled={disabled}
        />
        <ToNumberInput
          id={`${idPrefix}-recordingSeconds`}
          label="Record (s)"
          value={recordingSeconds}
          onChange={onRecordingSeconds}
          disabled={disabled}
        />
      </div>
    </>
  );
}

function TaskEditor({
  questionId,
  tasks,
  onChange,
  onCommitted,
  onRestoreTask,
  restoringTaskKey,
  disabled,
}: {
  questionId: string;
  tasks: AdminTask[];
  onChange: (tasks: AdminTask[]) => void;
  onCommitted: () => void;
  onRestoreTask: (taskId: string) => void;
  restoringTaskKey: string | null;
  disabled?: boolean;
}) {
  const [newPrompt, setNewPrompt] = useState("");
  const [newOrder, setNewOrder] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateLocal(index: number, task: AdminTask) {
    const next = tasks.slice();
    next[index] = task;
    onChange(next);
  }

  async function handleAdd() {
    setError("");
    const order = Number(newOrder);
    if (!newPrompt.trim()) {
      setError("Task prompt is required.");
      return;
    }
    if (!Number.isInteger(order) || order < 0 || !newOrder.trim()) {
      setError("Task order must be a non-negative integer.");
      return;
    }
    setLoading(true);
    try {
      const task = await createTask(questionId, {
        promptText: newPrompt.trim(),
        order,
      });
      onChange([...tasks, task]);
      onCommitted();
      setNewPrompt("");
      setNewOrder("");
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError(err.message);
      } else {
        setError("Failed to add task.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void handleAdd();
  }

  async function handleUpdate(index: number, patch: { promptText?: string; order?: number }) {
    setError("");
    const task = tasks[index];
    const promptText = patch.promptText?.trim();
    if (patch.promptText !== undefined && !promptText) {
      setError("Task prompt is required.");
      return;
    }
    if (patch.order !== undefined && (!Number.isInteger(patch.order) || patch.order < 0)) {
      setError("Task order must be a non-negative integer.");
      return;
    }
    try {
      const updated = await updateTask(questionId, task.id, {
        ...patch,
        ...(promptText !== undefined && { promptText }),
      });
      updateLocal(index, updated);
      onCommitted();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError(err.message);
      } else {
        setError("Failed to update task.");
      }
    }
  }

  async function handleRemove(index: number) {
    setError("");
    const task = tasks[index];
    try {
      await deleteTask(questionId, task.id);
      onChange(tasks.filter((_, i) => i !== index));
      onCommitted();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError(err.message);
      } else {
        setError("Failed to remove task.");
      }
    }
  }

  return (
    <div className="rounded-2xl border border-sn-border bg-sn-bg p-4 sm:p-5">
      <p className="mb-3 text-[15px] font-semibold">Tasks</p>

      {error && (
        <p role="alert" className={`${errorText} rounded-xl border border-sn-clay/30 bg-sn-clay/6 px-4 py-3 mb-3`}>{error}</p>
      )}

      {tasks.length === 0 ? (
        <p className="mb-3 text-sm text-sn-muted">No tasks added yet.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {tasks.map((task, index) => {
            const retired = isRetired(task);
            const taskKey = `${questionId}:${task.id}`;
            return (
              <li
                key={task.id}
                className="flex flex-col gap-3 rounded-xl border border-sn-border bg-sn-surface p-3 sm:flex-row sm:items-end"
              >
                <Field
                  id={`task-prompt-${task.id}`}
                  label="Prompt"
                  value={task.promptText}
                  onChange={(e) =>
                    updateLocal(index, { ...task, promptText: e.target.value })
                  }
                  disabled={disabled || retired}
                  className="flex-1"
                />
                <div className="w-full sm:w-24">
                  <Field
                    id={`task-order-${task.id}`}
                    label="Order"
                    type="number"
                    min={0}
                    step={1}
                    value={Number.isNaN(task.order) ? "" : String(task.order)}
                    placeholder="1"
                    onChange={(e) =>
                      updateLocal(index, {
                        ...task,
                        order: e.target.value === "" ? NaN : Number(e.target.value),
                      })
                    }
                    disabled={disabled || retired}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <LifecycleBadge entity="Task" retired={retired} />
                  {retired ? (
                    <Button
                      className={btnSecondary}
                      loading={restoringTaskKey === taskKey}
                      disabled={disabled || restoringTaskKey !== null}
                      onClick={() => onRestoreTask(task.id)}
                    >
                      Restore task
                    </Button>
                  ) : (
                    <>
                      <Button
                        className={btnSecondary}
                        disabled={disabled}
                        onClick={() =>
                          handleUpdate(index, {
                            promptText: task.promptText,
                            order: task.order,
                          })
                        }
                      >
                        Save
                      </Button>
                      <Button
                        className={btnDanger}
                        disabled={disabled}
                        onClick={() => handleRemove(index)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            id="new-task-prompt"
            label="New task prompt"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Task prompt"
            disabled={disabled || loading}
          />
        </div>
        <div className="w-full sm:w-24">
          <Field
            id="new-task-order"
            label="Order"
            type="number"
            min={0}
            step={1}
            value={newOrder}
            onChange={(e) => setNewOrder(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="1"
            disabled={disabled || loading}
          />
        </div>
        <Button
          type="button"
          className={btnSecondary}
          loading={loading}
          disabled={disabled}
          onClick={() => void handleAdd()}
        >
          Add task
        </Button>
      </div>
    </div>
  );
}

export default function AdminQuestionsPage() {
  const queryClient = useQueryClient();
  const [includeRetired, setIncludeRetired] = useState(false);
  const [restoringQuestionId, setRestoringQuestionId] = useState<string | null>(null);
  const [restoringTaskKey, setRestoringTaskKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const questionsQueryKey = [
    ...queryKeys.adminQuestions,
    { includeRetired },
  ] as const;
  const questionsQuery = useQuery({
    queryKey: questionsQueryKey,
    queryFn: ({ signal }) => fetchAdminQuestions({ includeRetired }, signal),
  });
  const questions = questionsQuery.data ?? [];

  const [createCategory, setCreateCategory] = useState("PART_1");
  const [createOrder, setCreateOrder] = useState("");
  const [createPrep, setCreatePrep] = useState("");
  const [createRecord, setCreateRecord] = useState("");
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("PART_1");
  const [editOrder, setEditOrder] = useState("");
  const [editPrep, setEditPrep] = useState("");
  const [editRecord, setEditRecord] = useState("");
  const [editTasks, setEditTasks] = useState<AdminTask[]>([]);
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const [confirmRetireId, setConfirmRetireId] = useState<string | null>(null);
  const [retireLoading, setRetireLoading] = useState(false);

  function updateQuestions(
    updater: (current: AdminQuestion[]) => AdminQuestion[],
  ) {
    queryClient.setQueryData<AdminQuestion[]>(
      questionsQueryKey,
      (current) => updater(current ?? []),
    );
  }

  function ordered(group: AdminQuestion[]) {
    return group.slice().sort((a, b) => a.order - b.order);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError("");
    let order: number;
    let preparationSeconds: number | undefined;
    let recordingSeconds: number | undefined;
    try {
      order = parseNonNegativeInteger(createOrder, "Order", true)!;
      preparationSeconds = parseNonNegativeInteger(createPrep, "Preparation time");
      recordingSeconds = parseNonNegativeInteger(createRecord, "Recording time");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Invalid question values.");
      return;
    }
    setCreateLoading(true);
    try {
      const question = await createQuestion({
        category: createCategory,
        order,
        preparationSeconds,
        recordingSeconds,
      });
      updateQuestions((current) => [...current, question]);
      setCreateOrder("");
      setCreatePrep("");
      setCreateRecord("");
      // Open the draft immediately so the admin can add tasks and prompt audio.
      startEdit(question);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to create question."
      );
    } finally {
      setCreateLoading(false);
    }
  }

  function startEdit(q: AdminQuestion) {
    setEditingId(q.id);
    setEditCategory(q.category);
    setEditOrder(String(q.order));
    setEditPrep(String(q.preparationSeconds));
    setEditRecord(String(q.recordingSeconds));
    setEditTasks(q.tasks.map((t) => ({ ...t })));
    setEditError("");
    setActionError("");
    setActionSuccess("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError("");
  }

  /** After a successful audio upload, update the row and its status badge. */
  function markAudioUploaded(id: string) {
    updateQuestions((current) =>
      current.map((q) =>
        q.id === id ? { ...q, audioUploadStatus: "UPLOADED" } : q
      )
    );
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditError("");
    let order: number;
    let preparationSeconds: number | undefined;
    let recordingSeconds: number | undefined;
    try {
      order = parseNonNegativeInteger(editOrder, "Order", true)!;
      preparationSeconds = parseNonNegativeInteger(editPrep, "Preparation time");
      recordingSeconds = parseNonNegativeInteger(editRecord, "Recording time");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Invalid question values.");
      return;
    }
    setEditLoading(true);
    try {
      const updated = await updateQuestion(editingId, {
        category: editCategory,
        order,
        preparationSeconds,
        recordingSeconds,
      });
      updateQuestions((current) =>
        current.map((q) =>
          q.id === editingId ? { ...updated, tasks: editTasks } : q
        )
      );
      setEditingId(null);
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : "Failed to update question."
      );
    } finally {
      setEditLoading(false);
    }
  }

  function requestRetire(id: string) {
    setConfirmRetireId(id);
    setActionError("");
    setActionSuccess("");
  }

  async function handleRetire() {
    if (!confirmRetireId) return;
    const questionId = confirmRetireId;
    setActionError("");
    setRetireLoading(true);
    try {
      await retireQuestion(questionId);
      updateQuestions((current) =>
        includeRetired
          ? current.map((q) =>
              q.id === questionId
                ? { ...q, deletedAt: q.deletedAt ?? new Date().toISOString() }
                : q,
            )
          : current.filter((q) => q.id !== questionId),
      );
      setEditingId((prev) => (prev === questionId ? null : prev));
      setConfirmRetireId(null);
      setActionSuccess("Question retired. Retained evidence is unchanged.");
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to retire question."
      );
    } finally {
      setRetireLoading(false);
    }
  }

  async function handleRestoreQuestion(id: string) {
    setActionError("");
    setActionSuccess("");
    setRestoringQuestionId(id);
    try {
      await restoreQuestion(id);
      const restored = questions.find((q) => q.id === id);
      updateQuestions((current) =>
        current.map((q) => (q.id === id ? { ...q, deletedAt: null } : q)),
      );
      setActionSuccess(
        restored
          ? `Question restored at ${categoryLabels[restored.category] ?? restored.category}, order ${restored.order}. Child task states are unchanged.`
          : "Question restored. Child task states are unchanged.",
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to restore question."
      );
    } finally {
      setRestoringQuestionId(null);
    }
  }

  async function handleRestoreTask(questionId: string, taskId: string) {
    setActionError("");
    setActionSuccess("");
    const taskKey = `${questionId}:${taskId}`;
    setRestoringTaskKey(taskKey);
    try {
      await restoreTask(questionId, taskId);
      const question = questions.find((q) => q.id === questionId);
      const task = question?.tasks.find((t) => t.id === taskId);
      updateQuestions((current) =>
        current.map((q) =>
          q.id === questionId
            ? {
                ...q,
                tasks: q.tasks.map((t) =>
                  t.id === taskId ? { ...t, deletedAt: null } : t,
                ),
              }
            : q,
        ),
      );
      setEditTasks((current) =>
        current.map((t) => (t.id === taskId ? { ...t, deletedAt: null } : t)),
      );
      setActionSuccess(
        task
          ? `Task restored at order ${task.order}. The parent question's lifecycle is unchanged.`
          : "Task restored. The parent question's lifecycle is unchanged.",
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to restore task."
      );
    } finally {
      setRestoringTaskKey(null);
    }
  }

  function setQuestionView(nextIncludeRetired: boolean) {
    setIncludeRetired(nextIncludeRetired);
    setActionError("");
    setActionSuccess("");
  }

  if (questionsQuery.isPending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-sn-muted" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (questionsQuery.isError) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-[15px] text-sn-muted">
          {questionsQuery.error instanceof ApiError
            ? questionsQuery.error.message
            : "Failed to load questions. Please try again."}
        </p>
        <button type="button" className={`${primaryButton} mt-5`} onClick={() => questionsQuery.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const group = (category: string) =>
    ordered(questions.filter((q) => q.category === category));

  return (
    <div className="space-y-10">
      <div>
        <h1 className={h2}>Question bank</h1>
        <p className={lead}>
          Manage speaking questions, grouped by part, and their tasks. Retiring a
          question never rewrites delivered submissions.
        </p>
      </div>

      {actionError && (
        <p role="alert" className={`${errorText} rounded-xl border border-sn-clay/30 bg-sn-clay/6 px-4 py-3 `}>{actionError}</p>
      )}

      {actionSuccess && (
        <p role="status" className="rounded-xl border border-sn-border bg-sn-field-green px-4 py-3 text-sm text-sn-ink-green">{actionSuccess}</p>
      )}

      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[15px] font-semibold">Question view</p>
          <p className="mt-1 text-sm text-sn-muted">
            Active questions are shown by default. Include retired records when needed for restoration.
          </p>
        </div>
        <div
          className="flex shrink-0 gap-2"
          role="group"
          aria-label="Question lifecycle view"
        >
          <button
            type="button"
            className={chip(!includeRetired)}
            aria-pressed={!includeRetired}
            onClick={() => setQuestionView(false)}
          >
            Active only
          </button>
          <button
            type="button"
            className={chip(includeRetired)}
            aria-pressed={includeRetired}
            onClick={() => setQuestionView(true)}
          >
            Active + retired
          </button>
        </div>
      </section>

      {/* Create form */}
      {!editingId && (
        <section>
          <h2 className={h3}>
            Create question
          </h2>
          <form
            onSubmit={handleCreate}
            noValidate
            className={`${card} mt-4`}
          >
            {createError && (
              <p role="alert" className={`${errorText} rounded-xl border border-sn-clay/30 bg-sn-clay/6 px-4 py-3 mb-4`}>{createError}</p>
            )}
            <div className="grid gap-4">
              <QuestionFormFields
                idPrefix="create-question"
                category={createCategory}
                onCategory={setCreateCategory}
                order={createOrder}
                onOrder={setCreateOrder}
                preparationSeconds={createPrep}
                onPreparationSeconds={setCreatePrep}
                recordingSeconds={createRecord}
                onRecordingSeconds={setCreateRecord}
                disabled={createLoading}
              />
              <div className="flex justify-end">
                <Button type="submit" className={btnPrimary} loading={createLoading}>
                  Create question
                </Button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* Edit form */}
      {editingId && (() => {
        const original = questions.find((q) => q.id === editingId);
        return (
          <section>
            <h2 className={h3}>
              Edit question
            </h2>
            <form
              onSubmit={handleSaveEdit}
              noValidate
              className={`${card} mt-4`}
            >
              {editError && (
                <p role="alert" className={`${errorText} rounded-xl border border-sn-clay/30 bg-sn-clay/6 px-4 py-3 mb-4`}>{editError}</p>
              )}
              <div className="grid gap-4">
                <QuestionFormFields
                  idPrefix="edit-question"
                  category={editCategory}
                  onCategory={setEditCategory}
                  order={editOrder}
                  onOrder={setEditOrder}
                  preparationSeconds={editPrep}
                  onPreparationSeconds={setEditPrep}
                  recordingSeconds={editRecord}
                  onRecordingSeconds={setEditRecord}
                  disabled={editLoading}
                />
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <p className="text-[15px] font-semibold">Prompt audio</p>
                    {original && (
                      <AudioUploadBadge status={original.audioUploadStatus} />
                    )}
                  </div>
                  {original?.audioUploadStatus === "UPLOADED" ? (
                    <p className="text-sm text-sn-muted">
                      Prompt audio is uploaded and ready for test delivery.
                    </p>
                  ) : (
                    <AudioUploadButton
                      questionId={editingId}
                      disabled={editLoading}
                      onUploaded={() => markAudioUploaded(editingId)}
                    />
                  )}
                  {original && original.audioUploadStatus !== "UPLOADED" && (
                    <p className="mt-2 text-xs text-sn-muted">
                      You can save this draft now. It will not appear in tests until its prompt audio is uploaded.
                    </p>
                  )}
                </div>
                <TaskEditor
                  questionId={editingId}
                  tasks={editTasks}
                  onChange={setEditTasks}
                  onRestoreTask={(taskId) => void handleRestoreTask(editingId, taskId)}
                  restoringTaskKey={restoringTaskKey}
                  onCommitted={() =>
                    void queryClient.invalidateQueries({
                      queryKey: questionsQueryKey,
                    })
                  }
                  disabled={editLoading}
                />
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    className={btnSecondary}
                    onClick={cancelEdit}
                    disabled={editLoading}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className={btnPrimary} loading={editLoading}>
                    Save changes
                  </Button>
                </div>
              </div>
              {original && (
                <p className="mt-4 text-xs text-sn-muted">
                  Created{" "}
                  {new Date(original.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </form>
          </section>
        );
      })()}

      {/* Question lists by category */}
      {!editingId && (
        <Tabs defaultValue="PART_1">
          <TabsList variant="line" className="mb-6 h-auto! w-full justify-start gap-1 rounded-none border-b border-sn-border p-0">
            {CATEGORIES.map((category) => (
              <TabsTrigger key={category} value={category} className="min-h-11 flex-none rounded-t-xl rounded-b-none px-4 text-[15px] font-normal text-sn-muted after:bottom-[-1px]! after:bg-sn-fg focus-visible:ring-0 data-active:font-medium data-active:text-sn-fg">
                {categoryLabels[category]}
              </TabsTrigger>
            ))}
          </TabsList>

          {CATEGORIES.map((category) => {
            const items = group(category);
            return (
              <TabsContent key={category} value={category}>
                {items.length === 0 ? (
                  <p className={empty}>No questions in this part yet. Create the first {categoryLabels[category]} question above.</p>
                ) : (
                  <div className="space-y-4">
                    {items.map((q) => {
                      const retired = isRetired(q);
                      return (
                        <div
                          key={q.id}
                          className={card}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex flex-wrap items-center gap-3">
                                <CategoryBadge category={q.category} />
                                <LifecycleBadge entity="Question" retired={retired} />
                                <span className={meta}>Order {q.order}</span>
                                <AudioUploadBadge status={q.audioUploadStatus} />
                              </div>
                              <p className="text-[15px] leading-6">
                                {q.tasks.length} task{q.tasks.length === 1 ? "" : "s"} ·{" "}
                                {q.preparationSeconds}s prep · {q.recordingSeconds}s recording
                              </p>
                              {q.tasks.length > 0 && (
                                <ul className="mt-3 space-y-1.5">
                                  {q.tasks
                                    .slice()
                                    .sort((a, b) => a.order - b.order)
                                    .map((t) => {
                                      const taskRetired = isRetired(t);
                                      return (
                                        <li
                                          key={t.id}
                                          className="flex flex-wrap items-center gap-2 border-l-2 border-sn-border pl-3 text-sm leading-6 text-sn-muted"
                                        >
                                          <span>
                                            <span className="font-medium text-sn-fg">{t.order}.</span>{" "}
                                            {t.promptText}
                                          </span>
                                          <LifecycleBadge entity="Task" retired={taskRetired} />
                                          {taskRetired && (
                                            <Button
                                              className={btnSecondary}
                                              loading={restoringTaskKey === `${q.id}:${t.id}`}
                                              disabled={
                                                restoringTaskKey !== null ||
                                                restoringQuestionId !== null
                                              }
                                              onClick={() => void handleRestoreTask(q.id, t.id)}
                                            >
                                              Restore task
                                            </Button>
                                          )}
                                        </li>
                                      );
                                    })}
                                </ul>
                              )}
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {retired ? (
                                <Button
                                  className={btnSecondary}
                                  loading={restoringQuestionId === q.id}
                                  disabled={
                                    restoringQuestionId !== null ||
                                    restoringTaskKey !== null
                                  }
                                  onClick={() => void handleRestoreQuestion(q.id)}
                                >
                                  Restore question
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    className={btnSecondary}
                                    onClick={() => startEdit(q)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    className={btnDanger}
                                    onClick={() => requestRetire(q.id)}
                                  >
                                    Retire
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {/* Retire confirmation */}
      <AlertDialog
        open={confirmRetireId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRetireId(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-32px)] rounded-3xl bg-sn-surface p-7 font-albert text-sn-fg ring-sn-border data-[size=default]:max-w-[460px] data-[size=default]:sm:max-w-[460px]">
          <AlertDialogHeader>
            <AlertDialogTitle className={h3}>Retire this question?</AlertDialogTitle>
            <AlertDialogDescription className="text-[15px] text-sn-muted">
              It will no longer be offered in new assessments. Prompt media
              remains available through retained submissions, and retained
              evidence is unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="-mx-7 -mb-7 mt-2 rounded-b-3xl border-sn-border bg-sn-bg px-7 py-5">
            <AlertDialogCancel className={btnSecondary}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={`${btnPrimary} border-sn-clay bg-sn-clay hover:bg-[color-mix(in_oklch,var(--color-sn-clay),black_12%)]`}
              onClick={handleRetire}
              loading={retireLoading}
            >
              Retire question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
