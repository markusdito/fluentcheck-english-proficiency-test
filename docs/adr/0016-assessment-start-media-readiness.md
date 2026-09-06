# Gate Assessment startup on one coordinator-owned Capture stream

Assessment startup requires Media readiness before creating or replaying a Submission. One persistent start coordinator owns the Capture stream and Assessment start intent across the permission UI and Assessment route; live camera and microphone tracks are authoritative, while device enumeration and the Device monitor are informational. A monitor or enumeration failure must not invalidate working capture, and loss of a required track pauses recording until recovery.

## Consequences

- Denied or unavailable hardware cannot create a new Submission.
- The permission UI and Assessment route cannot tear down and reacquire competing streams.
- Device-specific failures can be retried without discarding a working track.
- Existing Submissions remain resumable when hardware is temporarily unavailable.
