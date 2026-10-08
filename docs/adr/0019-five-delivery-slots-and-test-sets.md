# Deliver five slots from one Test Set

Status: Accepted. Supersedes the Required-category and shared-`order` clauses of ADR-0003 and the category/order Active position of ADR-0014.

PRD v0.3.0 structures the Assessment as four Parts recorded in five delivery slots: Part 1 Task 1A, Part 1 Task 1B, Part 2, Part 3 and Part 4 (`PART_1A`, `PART_1B`, `PART_2`, `PART_3`, `PART_4`). Questions are authored as Test Sets A–F, and a Submission must never mix sets. The implicit integer `order` that grouped Questions into a "question set" could not name a set, show its readiness, or be reported next to a score.

A Test Set is now a first-class record with a unique code. A Question belongs to exactly one Test Set, and only one active Question may occupy a Test Set slot. A Test Set is deliverable only when every slot holds an Eligible question; otherwise it is a Draft. Assessment start picks one deliverable Test Set, and a version 2 Submission manifest snapshots that Test Set's id and code and delivers the five slots in the fixed order 1A, 1B, 2, 3, 4 (positions 1 to 5). Default preparation/speaking seconds follow the slot (1A and 1B 10/45, Part 2 60/90, Part 3 60/90, Part 4 15/60) and stay admin-configurable per Question.

## Considered Options

- **Keep `order` and add slots.** Rejected: a set stays an unnamed integer with no readiness view and nothing to show next to a score.
- **Rewrite legacy evidence into five slots.** Rejected: manifests are immutable evidence and must never be reconstructed from the current bank.
- **Introduce Test Sets and a new manifest version, leaving legacy manifests as they are.** Chosen.

## Consequences

- The migration renames the enum label `PART_1` to `PART_1A` in place, so legacy Questions, Manifest entries and Answers stay readable without rewriting rows. Each distinct legacy `order` becomes a Test Set coded `LEGACY-<order>`; admins can rename it.
- Version 1 (three-slot) manifests stay valid legacy evidence with no Test Set. They are never delivered or completed. An unfinished version 1 attempt is stale, so the next Assessment start supersedes it with a version 2 manifest.
- Database triggers enforce the exact version 2 shape and require every new Submission to carry a complete version 2 manifest, which must name its Test Set. The ManifestEntry position check widens from 1–3 to 1–5.
- Completion requires exactly five Verified answers on a version 2 manifest.
- An unfinished attempt is also stale when a delivered Question moves to another Test Set.
- Submission APIs (dashboard, results, examiner, admin) expose the delivered Test Set code, taken from the manifest snapshot, so renaming a Test Set never rewrites history.
- How a Test Set is chosen for a student (random, rotating, avoiding a repeat on retake) stays open until piloting (PRD §3.4). Until then, selection is uniformly random among deliverable sets.
