# Snapshot delivered prompts in the Submission manifest

Every Submission manifest stores an immutable Delivered prompt snapshot for each selected Question, including the Question content, timing, active Task text and order, and Prompt media identity. This preserves the evidence needed to interpret retained Answers when the source Question is later edited or retired, while signed delivery URLs remain runtime presentation details rather than historical identity.

## Considered Options

- Store only Question IDs and read current Question data later.
- Store Question IDs plus a partial delivery record.
- Store the complete Delivered prompt snapshot in the Submission manifest.

## Consequences

- Retained Answers remain interpretable against the exact content presented to the student.
- Question edits and retirement cannot alter an existing Submission's delivered content.
- Manifest creation must capture active Tasks and Prompt media metadata atomically with the selected Questions.
- Prompt media remains retained while a Retained submission's manifest references it, even before an Answer exists.
- Explicit purge removes snapshots only after all related Answer and Prompt media references have been resolved.
- Signed Prompt media URLs are generated only for authorized runtime presentation and are not part of the historical snapshot.
- Missing historical Prompt media fails closed for authorized views and enters explicit reconciliation; current Question media is never substituted.
