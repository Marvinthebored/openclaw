# Talk consult thinking: live before/after

Recorded November 7, 2026, using isolated real Gateways and the shipped `talk.client.toolCall` handler over the authenticated Control UI connection. No mock model or mock chat handler was used. The handler supports legacy clients without a realtime audio session; this tests consultation dispatch and the returned agent result, not audio capture or playback.

Both instances used `talk.consultThinkingLevel: off`, session target `opencode-go/grok-4.7`, no model fallbacks, and the same question: `Reply with exactly TALK_CONSULT_OK_194184. Do not call tools.` Memory search was disabled for this isolated test.

The authorized provider's refreshed live catalog advertised Grok 4.7 as available with low/medium/high/xhigh plus host Ultra, excluding off. The generated config predates this model. Both overlays therefore registered its live-advertised ID using the existing Grok transport and pinned that advertised thinking ladder (`compat.thinkingLevels: [low, medium, high, xhigh]`, default medium). Pinning makes the model contract identical across builds; the older stock provider plugin otherwise derives an older generic ladder. No authentication material was changed or copied. Credentials came only through the approved test-Gateway secret resolver.

## Before

Build `9bda4788c4a8d7606441772d77ddae9127a6b032` (existing stock build). Its reply-admission source is byte-identical to PR main base `266a7aa0fe6`.

Shipped Talk call accepted run `talk-f9db052930d9621579ef253bf8790f139b230c0f44cd864f4fe63368507de6e3`, then returned this final rejection with zero model tokens:

> Thinking level "off" is not supported for opencode-go/grok-4.7. Use one of: low, medium, high, xhigh, ultra.

Raw safe event excerpt: [paired-before.json](paired-before.json).

## After

Build `b45e573e640aa7de70606f7e541eacc5aeada0a8`. All four changed production files are byte-identical to published PR head `69543ab3ced6f56ae8cef6ca3a6f8d4e021b28d3`; later commits only format tests and merge main.

Shipped Talk call accepted run `talk-61d7a39e7fd43ce53f091283b2228d84fd9ada468da063000d8c027374101be7`. Agent lifecycle selected `opencode-go/grok-4.7`; streamed output and final chat response returned:

> TALK_CONSULT_OK_194184

Raw safe event excerpt: [paired-after.json](paired-after.json). The ordinary strict rejection and unchanged supported/inherited preferences are covered separately by the failing-stock/passing-patch admission regressions.

## Report provenance and alternative routes

No original production log excerpt was captured. The original November 6 task brief reported three unsupported-off rejections for Claude Opus 5.5. The independent stock test above reproduces the same admission defect on a real supported account.

The isolated Gateway had no Anthropic/OpenAI account. Authorized Muse Spark 1.3 reached execution but returned provider HTTP 403 country restriction; MiniMax M2.7 reached execution but returned HTTP 410 ModelDeprecated. Grok 4.7 produced the successful real-agent result above. No alternate credentials were substituted.
