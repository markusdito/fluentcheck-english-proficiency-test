"use client";

import { useState, FormEvent, KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  fetchAdminQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  createTask,
  updateTask,
  deleteTask,
} from "@/lib/admin-api";
import type { AdminQuestion, AdminTask } from "@/types/admin";
import { queryKeys } from "@/lib/query-keys";
import { parseNonNegativeInteger } from "@/lib/question-form";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Loader2, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AudioUploadButton } from "@/components/admin/AudioUploadButton";
import { AudioUploadBadge } from "@/components/admin/AudioUploadBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
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
    <Badge variant="outline" data-tone="neutral">
      {categoryLabels[category] ?? category}
    </Badge>
  );
}

function ToNumberInput({
  value,
  onChange,
  id,
  label,
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <FormField
      id={id}
      label={label}
      type="number"
      min={0}
      step={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
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
      <div>
        <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Category <span className="text-signal">*</span>
        </p>
        <Select
          value={category}
          onValueChange={(v) => onCategory(v ?? "")}
          disabled={disabled}
        >
          <SelectTrigger size="default" className="w-full">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {categoryLabels[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ToNumberInput
          id={`${idPrefix}-order`}
          label="Order"
          value={order}
          onChange={onOrder}
          required
          disabled={disabled}
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
  disabled,
}: {
  questionId: string;
  tasks: AdminTask[];
  onChange: (tasks: AdminTask[]) => void;
  onCommitted: () => void;
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
    <div className="border border-rule bg-rule/20 p-4">
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        Tasks
      </p>

      {error && (
        <Alert variant="destructive" className="mb-3 items-start">
          <TriangleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {tasks.length === 0 ? (
        <p className="mb-3 text-sm text-ink-soft">No tasks added yet.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {tasks.map((task, index) => (
            <li
              key={task.id}
              className="flex flex-col gap-3 border border-rule bg-paper-raised p-3 sm:flex-row sm:items-end"
            >
              <FormField
                id={`task-prompt-${task.id}`}
                label="Prompt"
                value={task.promptText}
                placeholder="Task prompt"
                onChange={(e) =>
                  updateLocal(index, { ...task, promptText: e.target.value })
                }
                disabled={disabled}
                className="flex-1"
              />
              <div className="w-full sm:w-24">
                <FormField
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
                  disabled={disabled}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
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
                  variant="destructive"
                  size="sm"
                  disabled={disabled}
                  onClick={() => handleRemove(index)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <FormField
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
          <FormField
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
          variant="secondary"
          size="md"
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
  const questionsQuery = useQuery({
    queryKey: queryKeys.adminQuestions,
    queryFn: ({ signal }) => fetchAdminQuestions(signal),
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
  const [retireError, setRetireError] = useState("");

  function updateQuestions(
    updater: (current: AdminQuestion[]) => AdminQuestion[],
  ) {
    queryClient.setQueryData<AdminQuestion[]>(
      queryKeys.adminQuestions,
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
    setRetireError("");
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
    setRetireError("");
  }

  async function handleRetire() {
    if (!confirmRetireId) return;
    setRetireError("");
    setRetireLoading(true);
    try {
      await deleteQuestion(confirmRetireId);
      updateQuestions((current) =>
        current.filter((q) => q.id !== confirmRetireId),
      );
      setEditingId((prev) => (prev === confirmRetireId ? null : prev));
      setConfirmRetireId(null);
    } catch (err) {
      setRetireError(
        err instanceof ApiError ? err.message : "Failed to retire question."
      );
    } finally {
      setRetireLoading(false);
    }
  }

  if (questionsQuery.isPending) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-ink-faint" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (questionsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-ink-soft">
          {questionsQuery.error instanceof ApiError
            ? questionsQuery.error.message
            : "Failed to load questions. Please try again."}
        </p>
        <Button className="ml-4" onClick={() => questionsQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const group = (category: string) =>
    ordered(questions.filter((q) => q.category === category));

  return (
    <div className="space-y-12">
      <div>
        <p className="mark">Test bank</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
          Questions
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Manage speaking questions, grouped by part, and their tasks.
        </p>
      </div>

      {/* Create form */}
      <section>
        <p className="mark">New entry</p>
        <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
          Create question
        </h2>
        <form
          onSubmit={handleCreate}
          noValidate
          className="mt-4 border border-rule bg-paper-raised p-6"
        >
          {createError && (
            <Alert variant="destructive" className="mb-4 items-start">
              <TriangleAlertIcon />
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
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
              <Button type="submit" variant="default" loading={createLoading}>
                Create question
              </Button>
            </div>
          </div>
        </form>
      </section>

      {/* Edit form */}
      {editingId && (() => {
        const original = questions.find((q) => q.id === editingId);
        return (
          <section>
            <p className="mark">Amendments</p>
            <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-ink">
              Edit question
            </h2>
            <form
              onSubmit={handleSaveEdit}
              noValidate
              className="mt-4 border border-rule bg-paper-raised p-6"
            >
              {editError && (
                <Alert variant="destructive" className="mb-4 items-start">
                  <TriangleAlertIcon />
                  <AlertDescription>{editError}</AlertDescription>
                </Alert>
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
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                      Prompt audio
                    </p>
                    {original && (
                      <AudioUploadBadge status={original.audioUploadStatus} />
                    )}
                  </div>
                  {original?.audioUploadStatus === "UPLOADED" ? (
                    <p className="text-sm text-ink-soft">
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
                    <p className="mt-2 text-xs text-ink-soft">
                      You can save this draft now. It will not appear in tests until its prompt audio is uploaded.
                    </p>
                  )}
                </div>
                <TaskEditor
                  questionId={editingId}
                  tasks={editTasks}
                  onChange={setEditTasks}
                  onCommitted={() =>
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.adminQuestions,
                    })
                  }
                  disabled={editLoading}
                />
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={editLoading}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="default" loading={editLoading}>
                    Save changes
                  </Button>
                </div>
              </div>
              {original && (
                <p className="mt-4 text-xs text-ink-faint">
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

      {retireError && (
        <Alert variant="destructive" className="items-start">
          <TriangleAlertIcon />
          <AlertDescription>{retireError}</AlertDescription>
        </Alert>
      )}

      {/* Question lists by category */}
      <Tabs defaultValue="PART_1">
        <TabsList variant="line" className="mb-6">
          {CATEGORIES.map((category) => (
            <TabsTrigger key={category} value={category} className="px-4">
              {categoryLabels[category]}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map((category) => {
          const items = group(category);
          return (
            <TabsContent key={category} value={category}>
              {items.length === 0 ? (
                <div className="border border-dashed border-rule-strong bg-paper-raised px-6 py-12 text-center">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                    No questions in this part yet
                  </p>
                  <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-soft">
                    Create the first {categoryLabels[category]} question above.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {items.map((q) => (
                    <div
                      key={q.id}
                      className="border border-rule bg-paper-raised p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-3">
                            <CategoryBadge category={q.category} />
                            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                              Order {q.order}
                            </span>
                            <AudioUploadBadge status={q.audioUploadStatus} />
                          </div>
                          <p className="text-sm leading-6 text-ink">
                            {q.tasks.length} task{q.tasks.length === 1 ? "" : "s"} ·{" "}
                            {q.preparationSeconds}s prep · {q.recordingSeconds}s recording
                          </p>
                          {q.tasks.length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                              {q.tasks
                                .slice()
                                .sort((a, b) => a.order - b.order)
                                .map((t) => (
                                  <li
                                    key={t.id}
                                    className="border-l-2 border-rule-strong pl-3 text-xs leading-5 text-ink-soft"
                                  >
                                    <span className="font-medium text-ink">{t.order}.</span>{" "}
                                    {t.promptText}
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(q)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => requestRetire(q.id)}
                          >
                            Retire
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Retire confirmation */}
      <AlertDialog
        open={confirmRetireId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRetireId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Retire this question?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be offered in new assessments. Existing reports
              are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
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
