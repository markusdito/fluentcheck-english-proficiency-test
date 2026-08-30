# Account identity rollout

The account identity contract preserves a trimmed display `email` and uses
`normalizedEmail = lower(trim(email))` as the required, unique identity key.
`username` is stored as a trimmed lowercase value containing only lowercase
letters, digits, and underscores. Deactivated accounts remain in the table and
continue to reserve both identities.

## Rollout phases

1. The expand migrations add nullable `normalizedEmail`, allow provider-only
   accounts, and install temporary compatibility guards. The application
   dual-writes new accounts and can read the explicit null-key legacy fallback.
2. Run the read-only preflight against the same database that will receive the
   contract migration:

   ```sh
   npm run preflight:account-identity -- --json
   ```

   The report includes account counts and opaque account IDs for conflict
   remediation. It never prints email addresses, usernames, passwords, or
   changes account data. A nonzero exit code requires deliberate operator
   remediation; no account is merged or silently reassigned.

3. Before applying the contract phase, a human must explicitly confirm that the
   expand/dual-write release is deployed, no legacy application instance can
   still write the old shape, and a current recoverable database backup exists.
4. After that confirmation and a clean preflight, apply the normal Prisma
   migration deployment. The contract migration repeats its conflict checks in
   one PostgreSQL transaction, trims display email, canonicalizes unambiguous
   usernames, backfills normalized identities, removes raw-email uniqueness,
   removes the temporary fallback guards, and adds the final database checks.

The contract migration intentionally fails before mutation when its preflight
finds a conflict. It does not perform automatic rollback or identity repair;
resolve the reported opaque account IDs through the operator remediation
process and rerun the preflight.

## Post-contract checks

Run `npx prisma migrate status --schema prisma/schema.prisma`, rerun the
preflight and expect zero conflicts and zero legacy rows, then exercise the
native authentication and parser regression suites. The final application
looks up login accounts by `normalizedEmail` only; there is no legacy-read
fallback after the contract phase.
