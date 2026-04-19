interface AdapterGenerateOptions {
  key: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  signal: AbortSignal;
}

export default {
  async *generate(opts: AdapterGenerateOptions): AsyncGenerator<string> {
    const response = await fetch("https://api.minimax.chat/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.key}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          ...(opts.systemPrompt ? [{ role: "system", content: opts.systemPrompt }] : []),
          { role: "user", content: opts.prompt },
        ],
        stream: true,
      }),
      signal: opts.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Minimax error ${response.status}: ${err}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
};