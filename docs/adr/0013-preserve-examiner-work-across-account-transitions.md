# Preserve Examiner work across account transitions

A capability-removing transition must preserve every open Examiner assignment. Untouched `ASSIGNED` assignments may be reassigned through one atomic transition using an exact replacement map; the existing assignment ID and slot remain, and immutable reassignment history is appended. `IN_PROGRESS` or Completed Examiner assignments are never transferred. An `ADMIN` may finish existing assignments but is not an Eligible examiner for new assignment sets.

## Considered Options

- Reject every role change until all Examiner assignments are completed.
- Automatically choose replacements during a role change.
- Transfer in-progress Score drafts to a replacement Examiner.
- Delete and recreate assignment rows during reassignment.

## Consequences

- A capability-removing transition either reassigns all eligible open work or makes no account change.
- In-progress scoring remains with its original Examiner, avoiding draft-score loss and attribution ambiguity.
- Assignment identity, fixed slot, and scoring evidence remain stable across reassignment.
- The backend contract and frontend workflow must agree that `ADMIN` can finish existing assignments while only `EXAMINER` accounts are eligible for new assignment sets.
