# Make Submission initialization idempotent

Submission initialization uses a client-provided idempotency key so a retry after an ambiguous network result returns the same atomically created Submission manifest and delivery instead of creating a duplicate attempt. The key belongs to the authenticated student's Assessment start intent, is retained only for that Student and intent, and a later intentional Assessment starts with a new key. A key is replayable only while its Submission remains `IN_PROGRESS`; an explicit Abandonment or terminal transition closes that replay path.

The client persists the key with the authenticated Student identity in per-tab session state and discards it when the identity changes, the intent is abandoned, or the Submission reaches a terminal state. The API distinguishes an existing Active Submission from a key conflict belonging to another or already-closed intent, so the client can resume the former and rotate the latter exactly once.

## Consequences

- The client can safely retry initialization without orphaning duplicate Submissions.
- The server must retain and validate the idempotency result for the relevant Student and start-intent scope.
- A lost response is recoverable without selecting a second Question set.
- An Active Submission remains the authoritative resume target across tabs and sessions without allowing multiple active attempts.
- Abandonment is an explicit, idempotent lifecycle transition; clearing browser state alone cannot release the server-side active-attempt guard.
