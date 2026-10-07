Clean within the requested scope. No concrete defect found.

- **Exact patches:** `step-labels-final.patch` byte-matches the current five-file diff. The red patch contains exactly the fixture and actual UITests source, identical to their final hunks, with no production fix.
- **Proof script:** checks the test exists in source and `preparedTitle` is absent on base; requires the named test to fail specifically at the OCR “outcome unknown” assertion; then requires that same final UI test to pass.
- **Newly permitted state:** ended activity with absent status uses the local title while retaining the prepared unknown outcome.
- **Atomic concurrency:** the fix is a pure computed property and view read; it adds no mutable state or concurrency boundary.
- **Self/caller dependencies:** no recursive dependency introduced; the existing local display title supplies the fallback.
- **Wrong doc instructions:** none added.
- **Absence vs presence:** `status == nil` triggers fallback; present statuses preserve the Gateway title. OCR requires “exec” to be present as well as “outcome unknown” to be absent.

No autoreview, builds, or tests run. Execution logs and sourced helpers were outside scope, so this verifies the script’s checks, not an observed run.