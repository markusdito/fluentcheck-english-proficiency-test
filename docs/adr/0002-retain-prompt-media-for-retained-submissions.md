# Retain prompt media for retained submissions

FluentCheck retains a Question's Prompt media for as long as any Answer or Submission manifest on a Retained submission references it. Retiring a Question withdraws it from future delivery but never deletes its referenced Prompt media; any future cleanup must be explicit and auditable because preserving assessment evidence takes priority over reclaiming storage.

## Consequences

- Historical Prompt media is exposed only through an authorized Submission, examiner assignment, or admin detail view, not through direct retired-Question access.
- Existing retired Questions are reconciled with storage through a read-only check; missing evidence is reported and never fabricated.
- Preserving the complete Question and Task snapshot is resolved by ADR-0004 and is enforced through the Submission manifest.
- Explicit purge may remove delivery evidence only after confirming that no retained Answer or Submission manifest still references its Prompt media.
