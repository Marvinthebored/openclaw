# AI-assisted engineering log

- Reproduced user-carried parallel tool results not attaching to their calls.
- Split result blocks before history, live-event, and voice-reply ownership. Preserved separate presentation IDs and canonical transcript ancestry.
- Corrected correlated optimistic-user ordering and assigned carrier turn boundaries to one row.
- Ran production-path regression failures without the corresponding corrections, followed by passing affected Swift suites.
- Exercised the native simulator fixture before and after the fix; inspected both outputs and completed-work disclosure.

See [test output](test-output.md) and the before/after images.
