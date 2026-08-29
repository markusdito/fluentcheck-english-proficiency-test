# Bind question selection to a Submission manifest

When a new Submission is created, FluentCheck selects one Eligible question from each required category and atomically stores that selection and its Delivered prompt snapshots in an immutable Submission manifest. Submission creation returns the bound delivery, so the student flow cannot observe one question set while recording Answers against another; an incomplete question bank cannot produce a partially initialized Submission.

## Considered Options

- Keep Submission creation and question delivery as separate requests, linking them later.
- Preserve the current parallel creation and delivery requests.
- Bind selection and manifest creation atomically to the new Submission.

## Consequences

- A new Submission has exactly one selected Question from each required category.
- The required category set is explicitly `PART_1`, `PART_2`, and `PART_3`.
- Selection is randomized among Eligible questions and is not recomputed during that Submission.
- Selection is uniform within each required category.
- Delivery and Submission initialization share one server-owned boundary.
- Prompt media preparation for the three selected Questions completes before the final bounded database transaction. The transaction revalidates the selected sources and atomically persists the Submission and manifest; any preparation or revalidation failure creates nothing. This decision relies on preparation remaining local URL signing rather than a remote R2 availability probe.
- An unavailable or incomplete question bank returns a stable domain `503` and creates no Submission.
- The student flow treats Submission creation as the authoritative delivery operation; the standalone student delivery route is deprecated.
- Initialization retries reuse an idempotency key and do not create duplicate Submissions.
- Successful idempotency results remain available with the Retained submission; failed attempts that create no Submission remain retryable.
- Seed fixtures represent a complete uploaded-media bank; real R2 provisioning remains a separate verification concern.
- Submission completion requires exactly one Verified answer for every Manifest entry and does not consult the current Question bank.
- The frontend presents assessment unavailability as a server-owned condition with retry and support guidance.
- The former standalone student delivery route is transitional only and is not an authoritative source of delivery.

## Verification boundary

The acceptance matrix covers a complete bank, an empty bank, a category-incomplete bank, exclusion of ineligible Questions, and exact manifest-based completion.
