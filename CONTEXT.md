# FluentCheck

FluentCheck manages English-proficiency assessments from a student's recorded submission through payment, examiner scoring, and certification.

## Language

**Submission**:
A student's complete assessment attempt, including its recorded answers and progression through payment, scoring, and certification.
_Avoid_: Test, exam

**Retained submission**:
A Submission that has not been explicitly purged from FluentCheck, regardless of its completion, payment, or scoring state.
_Avoid_: Historical submission

**Legacy Submission**:
A Submission created before the Submission manifest contract; its historical delivery is preserved as-is and is never reconstructed from the current Question bank.
_Avoid_: Migrated submission, backfilled submission

**Question**:
A reusable English-proficiency prompt presented to a student as part of a Submission.
_Avoid_: Test question, exam question

**Required category**:
One of `PART_1`, `PART_2`, or `PART_3`; every new Submission contains exactly one selected Question from each Required category.
_Avoid_: Test section, question group

**Answer**:
A student's recorded response to one Question within a Submission.
_Avoid_: Recording, response file

**Verified answer**:
An Answer whose immutable media-object identity and required properties FluentCheck independently observed and bound to its Manifest entry.
_Avoid_: Uploaded answer, client-confirmed answer

**Retired question**:
A Question withdrawn from future delivery while remaining available to interpret every retained Answer that references it.
_Avoid_: Deleted question, soft-deleted question

**Prompt media**:
The audio content presented with a Question and required to interpret Answers recorded against that Question.
_Avoid_: Question file, storage object

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

**Scoring finalization**:
The authoritative domain operation that commits one Completed Examiner assignment and derives the owning Submission's scoring status from its complete Examiner assignment set.
_Avoid_: score submission, grading completion

**Score draft**:
A mutable Score recorded for an Examiner assignment before that assignment is completed; it may be replaced while scoring remains in progress but is frozen by completion.
_Avoid_: provisional grade, temporary result
