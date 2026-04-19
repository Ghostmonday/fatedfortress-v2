/**
 * net/tempo.ts — Tempo stablecoin payment client for paid rooms.
 *
 * Responsibilities:
 *   - Create payment intent (amount in USDC, host wallet address)
 *   - Redirect to Tempo wallet / payment page
 *   - Poll or webhook for payment confirmation
 *   - Write here.now edge gate config on payment success
 *
 * Flow:
 *   1. User clicks PAY on a paid room
 *   2. POST /tempo/intent { amount, hostWallet, ffWallet }
 *   3. Redirect to Tempo payment page
 *   4. On success → here.now edge function issues JWT cookie
 *   5. here.now edge function: 85% to host, 15% to FF (atomic split)
 *
 * FF wallet address: configured via TEMPO_FF_WALLET env var.
 * Host wallet: stored in room Y.js doc metadata.
 */

// TODO: net/tempo.ts
