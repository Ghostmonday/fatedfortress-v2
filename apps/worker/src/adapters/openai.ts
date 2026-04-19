/**
 * adapters/openai.ts — OpenAI API adapter.
 *
 * Implements the standard adapter interface:
 *   validateKey(key: string): Promise<boolean>
 *   listModels(key: string): Promise<Model[]>
 *   generate(opts: { key, model, prompt, systemPrompt, signal }): AsyncIterable<string>
 *
 * API style: OpenAI Chat Completions, streaming via text/event-stream
 * Endpoint: https://api.openai.com/v1/chat/completions
 * Models: gpt-4o, o3, o4-mini
 */

// TODO: adapters/openai.ts
