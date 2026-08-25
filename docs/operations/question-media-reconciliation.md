# Retired Question Prompt media reconciliation

Run the read-only reconciliation from `backend/` in an environment with database
and R2 read access:

```sh
npm run reconcile:question-media
```

Use `-- --json` to produce the same records and totals as JSON for an operational
record or automation:

```sh
npm run reconcile:question-media -- --json
```

The command reads every Retired Question, counts its retained Answers, and checks
Prompt media metadata and existence against R2 with `HEAD`. It never creates,
updates, restores, replaces, or deletes database records or Prompt media.

Exit status `1` means referenced evidence is missing, inconsistent, invalid, or
could not be inspected. A storage-service failure also returns `1` because the
check is incomplete. Unreferenced media is reported and is never deleted.

Attach the human report or JSON output to the relevant incident or recovery
ticket. Record every affected Question ID and whether it is referenced. Do not
upload or fabricate replacement Prompt media. Existing loss needs explicit
incident handling, but it must not delay deployment of the preventive retirement
fix that stops further deletion.
