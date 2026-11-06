# Composer draft isolation evidence

Source: PR 194235, ca086cfc2e38b5323ce82bb51dcfcfbd75462d0b.

The recording is an 8 fps, 360-pixel-wide transcode of the retained simulator recording (full duration, no audio). The chat is the screenshot-mode synthetic fixture. Contact sheet samples 40, 55, 70, 85 and 100 seconds.

Simulator draft-growth and active-response Stop checks passed; rotation/sidebar skipped. Logs are attached with local filesystem paths removed. Baseline observation regression fails; strengthened patched suite passes 15 tests. The test name was narrowed after the run; assertion bodies are unchanged.

The observation test is not a mounted SwiftUI runtime evaluation trace. The recording demonstrates rendered draft behavior, not avoided parent body evaluations or measured typing latency. That mounted trace remains outstanding.
