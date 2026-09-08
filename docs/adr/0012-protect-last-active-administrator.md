# Protect the last active administrator

FluentCheck treats role changes and supported account deactivation as one account-transition boundary. Each supported transition acquires a PostgreSQL transaction-level advisory lock keyed to the active-administrator invariant, re-reads the active administrator set, and commits the account mutation in that transaction. This prevents concurrent demotions or deactivations from leaving the system without an Active administrator while avoiding a new guard table.

## Considered Options

- Keep the administrator count and role update as separate operations.
- Use a serializable transaction with retries but no explicit invariant lock.
- Add a dedicated guard table or database trigger.

## Consequences

- All supported role and account-deactivation mutations must use the shared account-transition boundary.
- A transition that would remove the last Active administrator returns a stable conflict and makes no partial change.
- Direct data repair remains outside the normal account-mutation path.
