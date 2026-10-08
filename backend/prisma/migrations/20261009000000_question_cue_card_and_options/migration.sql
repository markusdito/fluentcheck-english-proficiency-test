-- Part 2 cue card and Part 3 options (PRD §3.2, FR-6.1). The Question holds
-- the editable content; each ManifestEntry snapshots what was delivered so
-- later edits never rewrite history. Adding nullable columns fires no row
-- triggers, so immutable manifest evidence stays untouched.
ALTER TABLE "Question" ADD COLUMN "cueCard" JSONB, ADD COLUMN "options" JSONB;
ALTER TABLE "ManifestEntry" ADD COLUMN "cueCard" JSONB, ADD COLUMN "options" JSONB;
