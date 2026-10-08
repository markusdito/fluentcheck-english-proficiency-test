# Enforce Examiner assignment sets with two fixed slots

Status: Accepted. Reaffirmed by PRD v0.3.1 FR-8.2: two Examiners score each Submission, and the result is the mean of their two Scores.

FluentCheck represents each Examiner assignment set as two fixed, non-ranked slots. Eligibility, both slot assignments, and the transition into scoring commit through one serialized operation, while database constraints prevent duplicate Examiner identities and excess slots. This deliberately trades flexible assignment cardinality for the product's independent two-Examiner scoring guarantee. Migration fails rather than fabricating or deleting irregular historical scoring evidence.
