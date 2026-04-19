/**
 * packages/protocol/src/index.ts — Shared types for FatedFortress.
 *
 * Re-exported from: @fatedfortress/protocol
 * Consumed by: apps/web, apps/worker, apps/relay
 *
 * Types:
 *   RoomId, ReceiptId, RoomCategory, RoomAccess
 *   PaletteIntent, PaletteContext, ParseResult
 *   BudgetToken, PaymentIntent
 *   PublicKeyBase58
 *   ProviderId
 *
 * Crypto helpers:
 *   FFError (error class with code + message)
 *   hashOutput(output: string): Promise<string>
 *   base64urlEncode / base64urlDecode
 *   verifyBudgetToken / generateTokenId / generateTokenNonce
 *   encodeBudgetTokenSigningMessage / isBudgetToken
 *   BUDGET_TOKEN_TTL_MS
 *
 * Constants:
 *   FF_ORIGIN, PROVIDER_ALLOWLIST
 */

// TODO: packages/protocol/src/index.ts
