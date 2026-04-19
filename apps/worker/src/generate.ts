import { FFError, hashOutput } from "@fatedfortress/protocol";
import { hasKey, getRawKey, type ProviderId } from "./keystore.js";
import type { InboundMessage, OutboundMessage } from "./router.js";

export const inFlight = new Map<string, AbortController>();

export async function handleGenerate(
  msg: Extract<InboundMessage, { type: "GENERATE" }>,
  requestId: string,
  controller: AbortController,
  send: (msg: OutboundMessage) => void
): Promise<void> {
  if (!hasKey(msg.provider as ProviderId)) {
    inFlight.delete(requestId);
    throw new FFError("NoKeyStored", `No key stored for provider: ${msg.provider}`);
  }

  try {
    const adapterModule = await import(
      /* @vite-ignore */ `./adapters/${msg.provider}.js`
    );
    const adapter = adapterModule.default ?? adapterModule;
    const key = getRawKey(msg.provider as ProviderId);

    const stream: AsyncIterable<string> = adapter.generate({
      key,
      model: msg.model,
      prompt: msg.prompt,
      systemPrompt: msg.systemPrompt,
      signal: controller.signal,
    });

    let fullOutput = "";

    for await (const chunk of stream) {
      if (controller.signal.aborted) break;
      fullOutput += chunk;
      send({ type: "CHUNK", requestId, chunk });
    }

    if (!controller.signal.aborted) {
      const outputHash = await hashOutput(fullOutput);
      send({ type: "DONE", requestId, outputHash });
    }
  } finally {
    inFlight.delete(requestId);
  }
}
