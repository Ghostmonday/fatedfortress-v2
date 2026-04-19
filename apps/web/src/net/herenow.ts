/**
 * net/herenow.ts — here.now publish client.
 *
 * Responsibilities:
 *   - Build HTML bundle from room state (brutalist template: black bg, JetBrains Mono)
 *   - ZIP bundle client-side (JSZip)
 *   - POST to here.now publish endpoint
 *   - Handle anonymous (24h) and authenticated (permanent) publishing
 *   - Return published URL written into Y.js doc receipt field
 *
 * here.now auth: here.now account token stored in sessionStorage.
 * No API key ever goes to here.now — here.now auth is separate from AI provider keys.
 */

// TODO: net/herenow.ts
