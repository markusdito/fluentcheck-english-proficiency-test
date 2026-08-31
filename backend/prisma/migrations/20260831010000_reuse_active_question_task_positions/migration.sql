-- Retired Questions and Tasks may share historical positions, while active
-- records remain unique at their delivery coordinates.
BEGIN;

DO $$
DECLARE
    question_conflict_groups INTEGER;
    task_conflict_groups INTEGER;
BEGIN
    SELECT COUNT(*)::int INTO question_conflict_groups
      FROM (
        SELECT "category", "order"
          FROM "Question"
         WHERE "deletedAt" IS NULL
         GROUP BY "category", "order"
        HAVING COUNT(*) > 1
      ) conflicts;

    SELECT COUNT(*)::int INTO task_conflict_groups
      FROM (
        SELECT "questionId", "order"
          FROM "Task"
         WHERE "deletedAt" IS NULL
         GROUP BY "questionId", "order"
        HAVING COUNT(*) > 1
      ) conflicts;

    IF question_conflict_groups > 0 OR task_conflict_groups > 0 THEN
        RAISE EXCEPTION
          'active question/task position migration preflight failed: question_conflict_groups=%, task_conflict_groups=%',
          question_conflict_groups,
          task_conflict_groups;
    END IF;
END;
$$;

DROP INDEX "Question_category_order_key";
DROP INDEX "Task_questionId_order_key";

CREATE UNIQUE INDEX "Question_category_order_key"
    ON "Question" ("category", "order")
    WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Task_questionId_order_key"
    ON "Task" ("questionId", "order")
    WHERE "deletedAt" IS NULL;

COMMIT;
