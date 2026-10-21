# Record every validated payment success

FluentCheck records every independently validated successful Payment attempt as `PAID`, even when another attempt has already paid the same Submission. Only the first success transitions the Submission and dispatches examiner assignment; later successes remain visible for Payment reconciliation because hiding or overwriting money actually received would corrupt the financial record.

## Consequences

- A Submission may have more than one `PAID` Payment attempt.
- Failure or expiration notifications never downgrade a `PAID` attempt, while a later valid success may upgrade a previously failed attempt.
- A correctly signed success callback that iPaymu's check-transaction API confirms (same transaction ID, Merchant reference, amount, and a paid status) remains eligible regardless of delivery delay; exact-attempt matching and idempotent transitions make replay safe without a freshness cutoff.
- The callback signature is keyed with the merchant VA number, which is not a secret, so a signature alone never proves that money was received.
- Duplicate-payment refunds and other reconciliation actions remain explicit operational work rather than automatic callback behavior.
