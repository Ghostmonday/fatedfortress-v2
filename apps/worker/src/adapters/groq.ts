/**
 * adapters/groq.ts — Groq API adapter.
 *
 * API style: OpenAI-compatible (Chat Completions), streaming
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 * Auth: Bearer GROQ_API_KEY
 * Models: llama-3.3-70b-versatile, mixtral-8x7b-32768
 *
 * NOTE: Groq is notable for very fast first-token latency.
 * Useful as a fallback when other providers are rate-limited.
 */

// TODO: adapters/groq.ts
