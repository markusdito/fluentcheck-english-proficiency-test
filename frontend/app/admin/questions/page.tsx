"use client";

import { useEffect, useState, FormEvent } from "react";
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
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

const CATEGORIES = ["PART_1", "PART_2", "PART_3"] as const;

const categoryLabels: Record<string, string> = {
  PART_1: "Part 1",
  PART_2: "Part 2",
  PART_3: "Part 3",
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
      {categoryLabels[category] ?? category}
    </span>
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
    <Input
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
  category,
  onCategory,
  promptText,
  onPromptText,
  order,
  onOrder,
  preparationSeconds,
  onPreparationSeconds,
  recordingSeconds,
  onRecordingSeconds,
  disabled,
}: {
  category: string;
  onCategory: (v: string) => void;
  promptText: string;
  onPromptText: (v: string) => void;
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
        <label
          htmlFor="category"
          className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
        >
          Category <span className="ml-0.5 text-[var(--danger)]">*</span>
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => onCategory(e.target.value)}
          disabled={disabled}
          className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabels[c]}
            </option>
          ))}
        </select>
      </div>

      <Input
        id="promptText"
        label="Prompt text"
        placeholder="Describe the scenario for this question"
        value={promptText}
        onChange={(e) => onPromptText(e.target.value)}
        required
        disabled={disabled}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <ToNumberInput
          id="order"
          label="Order"
          value={order}
          onChange={onOrder}
          required
          disabled={disabled}
        />
        <ToNumberInput
          id="preparationSeconds"
          label="Prep (s)"
          value={preparationSeconds}
          onChange={onPreparationSeconds}
          disabled={disabled}
        />
        <ToNumberInput
          id="recordingSeconds"
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
  disabled,
}: {
  questionId: string;
  tasks: AdminTask[];
  onChange: (tasks: AdminTask[]) => void;
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

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError("");
    const order = Number(newOrder);
    if (!newPrompt.trim() || !Number.isInteger(order)) {
      setError("Each task requires promptText and order.");
      return;
    }
    setLoading(true);
    try {
      const task = await createTask(questionId, {
        promptText: newPrompt.trim(),
        order,
      });
      onChange([...tasks, task]);
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

  async function handleUpdate(index: number, patch: { promptText?: string; order?: number }) {
    setError("");
    const task = tasks[index];
    try {
      const updated = await updateTask(questionId, task.id, patch);
      updateLocal(index, updated);
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
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError(err.message);
      } else {
        setError("Failed to remove task.");
      }
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-zinc-50 p-4">
      <p className="mb-3 text-sm font-semibold text-[var(--foreground)]">Tasks</p>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="mb-3 text-sm text-[var(--muted)]">No tasks added yet.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {tasks.map((task, index) => (
            <li
              key={task.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white p-2"
            >
              <input
                id={`task-prompt-${task.id}`}
                value={task.promptText}
                placeholder="Task prompt"
                onChange={(e) =>
                  updateLocal(index, { ...task, promptText: e.target.value })
                }
                disabled={disabled}
                className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="w-24 shrink-0">
                <input
                  id={`task-order-${task.id}`}
                  type="number"
                  min={0}
                  step={1}
                  value={Number.isNaN(task.order) ? "" : String(task.order)}
                  placeholder="Order"
                  onChange={(e) =>
                    updateLocal(index, {
                      ...task,
                      order: e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                  disabled={disabled}
                  className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdate(index, {
                      promptText: task.promptText,
                      order: task.order,
                    })
                  }
                  disabled={disabled}
                  className="rounded-md px-3 py-2 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  disabled={disabled}
                  className="rounded-md px-3 py-2 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label
            htmlFor="new-task-prompt"
            className="mb-1.5 block text-xs font-medium text-[var(--muted)]"
          >
            New task prompt
          </label>
          <input
            id="new-task-prompt"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder="Task prompt"
            disabled={disabled || loading}
            className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div className="w-full sm:w-24">
          <label
            htmlFor="new-task-order"
            className="mb-1.5 block text-xs font-medium text-[var(--muted)]"
          >
            Order
          </label>
          <input
            id="new-task-order"
            type="number"
            min={0}
            step={1}
            value={newOrder}
            onChange={(e) => setNewOrder(e.target.value)}
            placeholder="1"
            disabled={disabled || loading}
            className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <Button type="submit" variant="secondary" size="md" loading={loading} disabled={disabled}>
          Add task
        </Button>
      </form>
    </div>
  );
}

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [createCategory, setCreateCategory] = useState("PART_1");
  const [createPrompt, setCreatePrompt] = useState("");
  const [createOrder, setCreateOrder] = useState("");
  const [createPrep, setCreatePrep] = useState("");
  const [createRecord, setCreateRecord] = useState("");
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("PART_1");
  const [editPrompt, setEditPrompt] = useState("");
  const [editOrder, setEditOrder] = useState("");
  const [editPrep, setEditPrep] = useState("");
  const [editRecord, setEditRecord] = useState("");
  const [editTasks, setEditTasks] = useState<AdminTask[]>([]);
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const [confirmRetireId, setConfirmRetireId] = useState<string | null>(null);
  const [retireLoading, setRetireLoading] = useState(false);
  const [retireError, setRetireError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAdminQuestions();
        if (!cancelled) setQuestions(data);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load questions. Please try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function ordered(group: AdminQuestion[]) {
    return group.slice().sort((a, b) => a.order - b.order);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError("");
    const order = Number(createOrder);
    if (!createPrompt.trim() || !Number.isInteger(order)) {
      setCreateError("Prompt text and order are required.");
      return;
    }
    setCreateLoading(true);
    try {
      const question = await createQuestion({
        category: createCategory,
        promptText: createPrompt.trim(),
        order,
        preparationSeconds: createPrep ? Number(createPrep) : undefined,
        recordingSeconds: createRecord ? Number(createRecord) : undefined,
      });
      setQuestions((prev) => [...prev, question]);
      setCreatePrompt("");
      setCreateOrder("");
      setCreatePrep("");
      setCreateRecord("");
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
    setEditPrompt(q.promptText);
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

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditError("");
    const order = Number(editOrder);
    if (!editPrompt.trim() || !Number.isInteger(order)) {
      setEditError("Prompt text and order are required.");
      return;
    }
    setEditLoading(true);
    try {
      const updated = await updateQuestion(editingId, {
        category: editCategory,
        promptText: editPrompt.trim(),
        order,
        preparationSeconds: editPrep ? Number(editPrep) : undefined,
        recordingSeconds: editRecord ? Number(editRecord) : undefined,
      });
      setQuestions((prev) =>
        prev.map((q) =>
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
      setQuestions((prev) => prev.filter((q) => q.id !== confirmRetireId));
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

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-8 text-center shadow-lg">
          <p className="text-sm text-[var(--muted)]">{loadError}</p>
          <Button
            className="mt-6"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const group = (category: string) =>
    ordered(questions.filter((q) => q.category === category));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
          Questions
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage speaking questions, grouped by part, and their tasks.
        </p>
      </div>

      {/* Create form */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">
          Create question
        </h2>
        <form
          onSubmit={handleCreate}
          noValidate
          className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm"
        >
          {createError && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {createError}
            </div>
          )}
          <div className="grid gap-4">
            <QuestionFormFields
              category={createCategory}
              onCategory={setCreateCategory}
              promptText={createPrompt}
              onPromptText={setCreatePrompt}
              order={createOrder}
              onOrder={setCreateOrder}
              preparationSeconds={createPrep}
              onPreparationSeconds={setCreatePrep}
              recordingSeconds={createRecord}
              onRecordingSeconds={setCreateRecord}
              disabled={createLoading}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={createLoading}>
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
            <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">
              Edit question
            </h2>
            <form
              onSubmit={handleSaveEdit}
              noValidate
              className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm"
            >
              {editError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {editError}
                </div>
              )}
              <div className="grid gap-4">
                <QuestionFormFields
                  category={editCategory}
                  onCategory={setEditCategory}
                  promptText={editPrompt}
                  onPromptText={setEditPrompt}
                  order={editOrder}
                  onOrder={setEditOrder}
                  preparationSeconds={editPrep}
                  onPreparationSeconds={setEditPrep}
                  recordingSeconds={editRecord}
                  onRecordingSeconds={setEditRecord}
                  disabled={editLoading}
                />
                <TaskEditor
                  questionId={editingId}
                  tasks={editTasks}
                  onChange={setEditTasks}
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
                  <Button type="submit" variant="primary" loading={editLoading}>
                    Save changes
                  </Button>
                </div>
              </div>
              {original && (
                <p className="mt-4 text-xs text-[var(--muted)]">
                  Created {new Date(original.createdAt).toLocaleDateString("en-US", {
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
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {retireError}
        </div>
      )}

      {/* Question lists by category */}
      {CATEGORIES.map((category) => {
        const items = group(category);
        return (
          <section key={category}>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
              <CategoryBadge category={category} />
              <span>{categoryLabels[category]}</span>
              <span className="text-sm font-normal text-[var(--muted)]">
                {items.length} question{items.length === 1 ? "" : "s"}
              </span>
            </h2>

            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-white p-8 text-center shadow-sm">
                <p className="text-sm text-[var(--muted)]">
                  No questions in this part yet.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <CategoryBadge category={q.category} />
                          <span className="text-xs font-medium text-[var(--muted)]">
                            Order {q.order}
                          </span>
                          <span className="text-xs font-medium text-[var(--muted)]">
                            {q.tasks.length} task{q.tasks.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--foreground)]">{q.promptText}</p>
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          {q.preparationSeconds}s prep · {q.recordingSeconds}s recording
                        </p>
                        {q.tasks.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {q.tasks
                              .slice()
                              .sort((a, b) => a.order - b.order)
                              .map((t) => (
                                <li
                                  key={t.id}
                                  className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-[var(--muted)]"
                                >
                                  <span className="font-medium text-[var(--foreground)]">
                                    {t.order}.
                                  </span>{" "}
                                  {t.promptText}
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {confirmRetireId === q.id ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                            <span className="text-xs font-medium text-red-700">
                              Retire this question?
                            </span>
                            <button
                              type="button"
                              onClick={handleRetire}
                              disabled={retireLoading}
                              className="rounded-md bg-[var(--danger)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {retireLoading ? "Retiring…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRetireId(null)}
                              disabled={retireLoading}
                              className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEdit(q)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => requestRetire(q.id)}
                            >
                              Retire
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
