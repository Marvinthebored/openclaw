# Native interaction trace

iPhone 17 Pro simulator, iOS 26.5. The app uses the fixed 700 ms Stop guard.

t =     3.66s Waiting 8.0s for "RootTabs.Ready" Any to exist
t =     4.70s         Checking existence of `"RootTabs.Ready" Any`
t =     5.86s Waiting 8.0s for "chat-message-input" Any to exist
t =     6.89s         Checking existence of `"chat-message-input" Any`
t =     6.93s Tap "chat-message-input" Any
t =     8.46s Waiting 5.0s for "chat-send-message" Button to exist
t =     9.50s         Checking existence of `"chat-send-message" Button`
t =    10.68s Tap Target Application 'ai.openclawfoundation.app.debug'[0.00, 0.00] -> (362.0, 501.0)
t =    11.09s Tap Target Application 'ai.openclawfoundation.app.debug'[0.00, 0.00] -> (362.0, 501.0)
t =    11.51s Waiting 5.0s for "Stop response" Button to exist
t =    12.54s     Checking `Expect predicate `existsNoRetry == 1` for object "Stop response" Button`
t =    12.54s         Checking existence of `"Stop response" Button`
t =    13.62s Checking `Expect predicate `enabled == 1` for object "Stop response" Button`
t =    13.62s     Find the "Stop response" Button
t =    13.79s Added attachment named 'stop-guard-response-survived-double-tap'
t =    13.79s Tap "stop.fill" Button
t =    14.15s Waiting 8.0s for "stop.fill" Button to not exist
t =    15.18s         Checking existence of `"stop.fill" Button`
t =    15.35s Added attachment named 'stop-guard-deliberate-stop-cancelled-response'

Test Case '-[OpenClawUITests.OpenClawSnapshotUITests testStopIgnoresTapsForAMomentAfterItReplacesSend]' passed (16.428 seconds).

## Counterfactual: Stop guard removed

t =    10.08s Tap Target Application 'ai.openclawfoundation.app.debug'[0.00, 0.00] -> (362.0, 501.0)
t =    10.49s Tap Target Application 'ai.openclawfoundation.app.debug'[0.00, 0.00] -> (362.0, 501.0)
XCTAssertTrue failed - STOP_GUARD_MISSING: double-tapping Send cancelled the response
Test Case '-[OpenClawUITests.OpenClawSnapshotUITests testStopIgnoresTapsForAMomentAfterItReplacesSend]' failed (17.347 seconds).
