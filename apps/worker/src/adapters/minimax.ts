/**
 * adapters/minimax.ts — Minimax API adapter.
 *
 * API style: OpenAI-compatible (Chat Completions), streaming
 * Endpoint: https://api.minimax.chat/v1/chatcompletion_v2
 * Auth: Bearer MX_API_KEY
 * Models: abab (chat), MX-T2V (text-to-video), SDXL (image)
 *
 * NOTE: Minimax T2V returns a video URL, not text.
 * Handle specially in generate() — for v1, stream the URL as text.
 * Future: detect model type and handle media URLs appropriately.
 */

// TODO: adapters/minimax.ts
