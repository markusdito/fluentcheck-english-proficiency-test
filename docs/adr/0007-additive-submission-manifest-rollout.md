# Roll out Submission manifests additively

FluentCheck introduces relational Submission manifests and Manifest entries without fabricating delivery history for existing Submissions. New Submissions must be created with a complete manifest, while pre-manifest rows remain explicitly legacy until a separate evidence-preserving migration is designed and approved.

## Considered Options

- Backfill every existing Submission from the current Question bank.
- Invalidate or block all existing Submissions.
- Add the manifest contract for new Submissions and preserve existing rows as legacy.

## Consequences

- The migration can deploy without rewriting uncertain historical evidence.
- The additive persistence migration permits manifest-less rows until old writers are drained; a later cutover enables rejection of new manifest-less Submissions without reclassifying Legacy rows.
- New completion and interpretation paths can enforce manifest invariants.
- Legacy handling remains an explicit compatibility boundary rather than an implicit fallback.
