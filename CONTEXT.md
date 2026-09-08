# FluentCheck

FluentCheck manages English-proficiency assessments from a student's recorded submission through payment, examiner scoring, and certification.

## Language

**Submission**:
A student's complete assessment attempt, including its recorded answers and progression through payment, scoring, and certification.
_Avoid_: Test, exam

**Active Submission**:
An `IN_PROGRESS` Submission that is the student's current assessment attempt; a student has at most one Active Submission.
_Avoid_: Open test, pending test

**Review-pipeline submission**:
A Submission that has finished recording and is moving through payment and Examiner scoring without yet being Scored or Abandoned. A student cannot start a new Assessment while a Review-pipeline submission exists.
_Avoid_: Active submission, submission being reviewed

**Assessment**:
The speaking experience in which a student receives one Question from each Required category and records one Answer for each.
_Avoid_: Test, exam

**Assessment start intent**:
A student's request to create or resume one Submission. Retrying the same intent preserves that Submission, while an intentional later Assessment uses a new intent.
_Avoid_: Test initialization, restart request

**Abandonment**:
An explicit end of an Active Submission that preserves its retained evidence and permits a later Assessment start.
_Avoid_: Deletion, purge, cancellation

**Retained submission**:
A Submission that has not been explicitly purged from FluentCheck, regardless of its completion, payment, or scoring state.
_Avoid_: Historical submission

**Purge request**:
An explicit, reasoned request to remove a Submission's purgeable evidence under the approved retention policy; it is not itself permission to delete evidence.
_Avoid_: Deletion request, cleanup request

**Quarantined submission**:
A Submission whose purge has been approved and whose evidence is temporarily protected from access and irreversible deletion while recovery remains possible.
_Avoid_: Deleted submission, archived submission

**Purged submission**:
A Submission whose purgeable evidence has been removed after the approved quarantine boundary, while the minimum immutable retention audit remains.
_Avoid_: Deleted attempt, erased submission

**Retention hold**:
An explicit reason a Submission must remain retained, such as a legal matter, dispute, scoring review, recovery investigation, or certificate obligation.
_Avoid_: Cleanup exception, deletion lock

**Legacy Submission**:
A Submission created before the Submission manifest contract; its historical delivery is preserved as-is and is never reconstructed from the current Question bank.
_Avoid_: Migrated submission, backfilled submission

**Question**:
A reusable English-proficiency prompt presented to a student as part of a Submission.
_Avoid_: Test question, exam question

**Task**:
A sub-prompt belonging to a Question and answered within that Question's single recorded Answer.
_Avoid_: Grading task, question assignment

**Required category**:
One of `PART_1`, `PART_2`, or `PART_3`; every new Submission contains exactly one selected Question from each Required category.
_Avoid_: Test section, question group

**Answer**:
A student's recorded response to one Question within a Submission.
_Avoid_: Recording, response file

**Media readiness**:
The condition in which an Assessment has live camera and microphone capture available for every recorded Answer.
_Avoid_: Permission granted, device list

**Capture stream**:
The camera and microphone media used to record Answers during an Assessment.
_Avoid_: Device permission, preview

**Device monitor**:
Optional feedback that helps a student observe microphone input during an Assessment. Its unavailability does not invalidate Media readiness.
_Avoid_: Microphone permission, recording proof

**Verified answer**:
An Answer whose immutable media-object identity and required properties FluentCheck independently observed and bound to its Manifest entry.
_Avoid_: Uploaded answer, client-confirmed answer

**Retired question**:
A Question withdrawn from future delivery while retaining its identity and all references from retained Submission evidence. It may be explicitly restored if its original position is available.
_Avoid_: Deleted question, soft-deleted question

**Retired task**:
A Task withdrawn from future delivery while retaining its identity and relationship to its Question.
_Avoid_: Deleted task, soft-deleted task

**Active position**:
The category/order coordinate of a Question or the Question/order coordinate of a Task. Only one active record may occupy a position; multiple retired records may share it over time.
_Avoid_: Permanent slot

**Question replacement**:
A new Question created at a position previously held by a Retired question. It has an independent identity, Task set, and Prompt media.
_Avoid_: Restored question

**Restoration**:
An explicit return of a Retired question or Retired task to active administration at its original identity and position. Restoration does not restore child records and fails when an active record occupies that position.
_Avoid_: Undeletion

**Prompt media**:
The audio content presented with a Question and required to interpret Answers recorded against that Question.
_Avoid_: Question file, storage object

**Prompt-media cleanup candidate**:
A retired Question Prompt-media identity reported for cleanup after checking every retained Answer and Delivered prompt snapshot that may reference it.
_Avoid_: Orphan file, unused audio

**Cleanup quarantine**:
The recoverable interval after cleanup authorization during which the exact Prompt-media identity remains available and no irreversible storage deletion is allowed.
_Avoid_: Soft deletion, archive window

**Irreversible deletion**:
The point after storage confirms that a quarantined evidence object is absent and FluentCheck can no longer recover it through the approved workflow.
_Avoid_: Delete requested, cleanup started

**Retention audit event**:
An immutable record of a retention request, decision, quarantine transition, storage attempt, recovery action, or deletion outcome.
_Avoid_: Log line, audit note

**Prompt media preparation**:
Creation of a non-empty, absolute HTTPS runtime-authorized URL for selected Prompt media from its retained identity metadata. It proves that FluentCheck can prepare authorized presentation, not that the R2 object exists, is currently readable, or will play in the student's browser.
_Avoid_: Prompt delivery verification, media availability check

**Delivered prompt snapshot**:
An immutable record of the Question content, timing, and Prompt media identity presented within one Submission.
_Avoid_: Current question, question copy

**Eligible question**:
An active Question with available Prompt media and at least one active Task that can be included in a new Submission.
_Avoid_: Ready question, test question

**Submission manifest**:
An immutable record of the Questions selected, one per required category, their delivery order, and the Delivered prompt snapshots presented within one Submission. It remains authoritative even when the source Questions are later edited or retired.
_Avoid_: Test configuration, question list

**Assessment unavailable**:
A temporary condition in which FluentCheck cannot safely create a complete Submission because Question selection or Prompt media preparation cannot satisfy the delivery contract.
_Avoid_: Connection error, generic server error

**Manifest entry**:
The Submission manifest's identity-bearing record for one selected Question and its Delivered prompt snapshot; Answers and downstream interpretation attach to this entry rather than to the mutable Question bank.
_Avoid_: Question assignment, current question link

**Payment attempt**:
A single request to open a provider checkout for one Submission. It retains its own identity and outcome independently of earlier or later attempts.
_Avoid_: Payment request, checkout

**Merchant reference**:
An immutable FluentCheck-generated identifier belonging to exactly one Payment attempt and returned by the payment provider in notifications.
_Avoid_: Provider reference, submission reference

**Provider session ID**:
The payment provider's identifier for the hosted checkout session created for a Payment attempt.
_Avoid_: Merchant reference, transaction ID

**Provider transaction ID**:
The payment provider's identifier for a completed or otherwise reported payment transaction.
_Avoid_: Merchant reference, session ID

**Paid submission**:
A Submission with at least one validated successful Payment attempt. Examiner assignment is a separate, retryable transition.
_Avoid_: Assigned submission

**Examiner**:
A person authorized to independently score a Submission.
_Avoid_: Jury, reviewer, marker

**Assignment-capable account**:
An active account authorized to work on an existing Examiner assignment. An `EXAMINER` and an `ADMIN` may be assignment-capable, but only an active `EXAMINER` is an Eligible examiner for a new Examiner assignment set.
_Avoid_: Eligible examiner when referring to existing assignment access

**Eligible examiner**:
An Examiner whose account is active and authorized when a new Examiner assignment set is committed.
_Avoid_: Available examiner

**Examiner assignment**:
An obligation for one Examiner to independently score one Submission.
_Avoid_: Review, grading task

**Examiner assignment set**:
Exactly two distinct Examiner assignments committed together for one Assignment-ready submission; neither Examiner has rank or priority.
_Avoid_: Examiner pair, jury

**Assignment-ready submission**:
A completed Submission whose payment requirement is satisfied or waived and which has not received an Examiner assignment set.
_Avoid_: Paid submission, unassigned submission

**Payment reconciliation**:
Reviewing recorded Payment attempts against provider records, including ambiguous outcomes or more than one successful attempt for the same Submission.
_Avoid_: Payment repair, payment overwrite

**Completed Examiner assignment**:
An Examiner assignment whose required Answers have valid Scores and whose scoring submission is committed; it is no longer editable, and repeating completion is a successful no-op.
_Avoid_: finalized review, scored assignment

**Open Examiner assignment**:
An Examiner assignment in `ASSIGNED` or `IN_PROGRESS` status that is not yet a Completed Examiner assignment. Only an untouched `ASSIGNED` assignment may be reassigned; `IN_PROGRESS` work remains with its Examiner until completion.
_Avoid_: Pending grading, incomplete assignment

**Examiner assignment reassignment**:
An authorized transfer of an `ASSIGNED` Examiner assignment to another Eligible examiner while preserving its assignment identity and slot. Each transfer is recorded in immutable reassignment history.
_Avoid_: Assignment replacement

**Capability-removing transition**:
A role or account-state change that would prevent an account from working an existing Examiner assignment, including changing to `STUDENT` or deactivating the account.
_Avoid_: Role update, account deletion

**Active administrator**:
An active account with the `ADMIN` role. FluentCheck must always retain at least one Active administrator.
_Avoid_: Administrator account when referring to an inactive account

**Reassignment history**:
An immutable record of one Examiner assignment transfer, including the departing Examiner, receiving Examiner, acting `ADMIN`, and transition reason.
_Avoid_: Assignment audit note

**Scoring finalization**:
The authoritative domain operation that commits one Completed Examiner assignment and derives the owning Submission's scoring status from its complete Examiner assignment set.
_Avoid_: score submission, grading completion

**Score draft**:
A mutable Score recorded for an Examiner assignment before that assignment is completed; it may be replaced while scoring remains in progress but is frozen by completion.
_Avoid_: provisional grade, temporary result
