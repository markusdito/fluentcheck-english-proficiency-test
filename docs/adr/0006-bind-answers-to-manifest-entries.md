# Bind Answers and interpretation to manifest entries

An Answer belongs to the Manifest entry for the delivered Question within its Submission, and examiner, admin, and result views interpret that entry's immutable snapshot. The mutable Question bank remains the source for future delivery and administration, not for redefining a retained Submission.

## Considered Options

- Keep `Answer.questionId` as the authoritative relationship and validate it against the manifest.
- Introduce a Manifest entry relationship and retain the source Question ID only as historical identity.
- Re-read current Questions whenever an Answer is viewed.

## Consequences

- Completion can require exactly the manifest entries without consulting the current Question bank.
- A Manifest-backed Answer becomes a Verified answer only after FluentCheck independently observes and binds immutable media-object identity and required properties; client-confirmed upload state is not proof.
- Question edits and retirement cannot change examiner context or result interpretation.
- Authorized runtime media access signs the snapshot's stored media identity rather than resolving current Question media.
- Legacy Submissions remain outside this relationship until an explicit, evidence-preserving migration is designed.
