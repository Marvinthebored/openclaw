# Matched iOS simulator proof — personal session pins

Verified on iPhone 17 Pro / iOS 26.5 with separate disposable Gateways and profiles. The app source archives were the exact merge base f0e04c2f13af7d503ee4e304c27d8449965f564c and exact PR head 669ae72f7a9bbd48daf36b66ee2e044d32ea7353, with the same debug readback harness. One XCTest passed on each lane. Both runs used a signed-in operator.

| Run | Personal membership (before → Pin → Unpin) | Shared pinned / timestamp present |
| --- | --- | --- |
| Merge base | false → false → false | false → true → false for both fields |
| PR head | false → true → false | false throughout for both fields |

At each checkpoint the native app read preferences and session metadata on the same operator route and found the pre-seeded sentinel. The full shared pin tuple matched the baseline at all head checkpoints; base changed on Pin and matched the baseline again after Unpin. Native XCTest also checked the Pin → Unpin → Pin menu transitions.

Readbacks: [base](matched-base-checkpoints.txt), [head](matched-head-checkpoints.txt). Both xcresult attachment exports were empty. The separate seeded upgrade run has visual evidence; it is not a screenshot record of this comparison.
