interface AdapterGenerateOptions {
  key: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  signal: AbortSignal;
}

export default {
  async *generate(opts: AdapterGenerateOptions): AsyncGenerator<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:streamGenerateContent?key=${opts.key}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: opts.prompt }],
          ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
        }],
        stream: true,
      }),
      signal: opts.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google error ${response.status}: ${err}`);
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
          try {
            const parsed = JSON.parse(data);
            const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (content) yield content;
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
};