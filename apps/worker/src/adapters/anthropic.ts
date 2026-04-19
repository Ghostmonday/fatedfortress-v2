/**
 * adapters/anthropic.ts — Anthropic API adapter.
 *
 * API style: Anthropic Messages API, streaming via text/event-stream
 * Endpoint: https://api.anthropic.com/v1/messages
 * Models: claude-4-sonnet, claude-4-opus, claude-haiku
 *
 * NOTE: Anthropic uses a different auth header (x-api-key) and a different
 * streaming format (anthropic event stream) from OpenAI-compatible providers.
 * Use fetch with ReadableStream byte handling, not a simple text reader.
 */

// TODO: adapters/anthropic.ts
