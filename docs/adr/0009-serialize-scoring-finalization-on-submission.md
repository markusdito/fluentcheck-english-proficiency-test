# Serialize scoring finalization on the Submission row

Both score-completion APIs use one transactional Scoring finalization operation. It locks the Submission row, writes the assignment completion and any bulk Scores, then derives `SCORING` or `SCORED` from the Examiner assignment set; existing `SCORED` and `CERTIFIED` statuses are never downgraded. Repeating completion succeeds as a no-op without rewriting completed Scores, because the Submission owns the lifecycle and explicit row locking makes concurrent finalization deterministic.

## Considered Options

- Keep bulk status derivation outside the assignment transaction.
- Use serializable transactions and rely on retries for all contention.
- Serialize on the Submission row and make status transitions monotonic.
- Treat malformed historical assignment sets as repair cases rather than making normal scoring repair them.
- Let draft Score saves use an independent transaction and trust an earlier status check.

## Consequences

- The manual and bulk completion routes share one lifecycle boundary.
- Completed Examiner assignments become immutable and safely replayable.
- Finalization must acquire the Submission lock before deriving status.
- Score drafts remain editable until completion; all score writes must respect the same completion boundary.
- Invalid assignment cardinality or terminal-status inconsistencies require explicit repair.
- Normal finalization accepts only `SCORING`; invalid lifecycle states are reported as conflicts, while completed replays return success without comparing payloads.
- Controlled-overlap tests must cover two bulk completions, mixed completion routes, partial completion, repeated completion, and a draft-save/finalization race.
