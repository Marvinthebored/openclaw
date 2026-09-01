import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Context, Model } from "../../packages/ai/src/types.js";

type ProviderRefusalLoopback = {
  context: Context;
  model: Model<"anthropic-messages">;
  requestCount: () => number;
};

export async function withProviderRefusalLoopback<T>(
  run: (fixture: ProviderRefusalLoopback) => Promise<T>,
): Promise<T> {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      [
        { type: "message_start", message: { id: "msg_refusal", usage: {} } },
        {
          type: "message_delta",
          delta: {
            stop_reason: "refusal",
            stop_details: {
              type: "refusal",
              category: "reasoning_extraction",
              explanation: "This request is refused; prompt is too long.",
            },
          },
          usage: { input_tokens: 3, output_tokens: 0 },
        },
        { type: "message_stop" },
      ]
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join(""),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const fixture = {
    model: {
      id: "mock-1",
      name: "Anthropic refusal proof",
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: `http://127.0.0.1:${port}`,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 2_048,
    } satisfies Model<"anthropic-messages">,
    context: {
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    } satisfies Context,
    requestCount: () => requests,
  };

  try {
    return await run(fixture);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
