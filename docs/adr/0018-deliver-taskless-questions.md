# Deliver taskless Questions

Status: Accepted. Supersedes the task-requirement clause of ADR-0014 and relaxes ADR-0004's assumption that every Delivered prompt snapshot carries active Tasks.

An eligible Question is one that is active with complete Prompt media; active Tasks are optional enrichment, not a delivery requirement. Not every Question needs sub-prompts, so requiring at least one active Task made a taskless Question render its entire Required category undeliverable and surfaced to students as a generic "Assessment unavailable".

## Considered Options

- **Keep Tasks mandatory (prior policy).** Rejected: it conflates "has no Tasks" with "is not ready", so a valid audio-only Question silently poisons its whole category.
- **Treat every taskless Question as a permanent draft.** Rejected: it entrenches the same false equivalence and contradicts the fact that some Questions are complete without Tasks.
- **Make Tasks optional and mark audio-only delivery explicitly.** Chosen.

## Consequences

- A Required category is deliverable when it contains at least one active, media-ready Question, regardless of its Tasks. Prompt media, not Tasks, is what makes an Answer interpretable.
- Eligibility is a single per-Question predicate—active and complete Prompt media—shared by the manifest-based Assessment start and the legacy test-question path, so the two cannot drift. The shared-order rule of ADR-0003 is orthogonal: an order is deliverable only when every Required category has an eligible Question at that order, and Tasks never affect which orders are common.
- A manifest entry may snapshot zero Tasks. Task ordering and continuity rules apply only when Tasks are present.
- Forgetting to add intended Tasks no longer fails loudly at start time. The admin bank marks a media-ready taskless Question as "Audio only — no Tasks" so that omission is deliberate and visible rather than silent.
- A genuinely empty or media-incomplete bank still fails as Assessment unavailable, but reported as a distinct persistent bank gap rather than a retryable preparation failure.
