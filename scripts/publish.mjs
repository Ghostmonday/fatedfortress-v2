#!/usr/bin/env node
/**
 * scripts/publish.mjs — here.now deployment script.
 *
 * Usage:
 *   node scripts/publish.mjs [--env production|staging]
 *
 * Steps:
 *   1. Build web app: vite build (apps/web)
 *   2. Build worker app: vite build (apps/worker)
 *   3. Compute worker hash: node scripts/verify-worker-hash.mjs --build
 *   4. Deploy to here.now: here ./dist --spa --client fatedfortress
 *   5. Update here.now routing config with worker SRI hash
 *
 * here.now CLI must be installed: npm install -g @here команд
 * or: npx here ./dist --spa --client fatedfortress
 */

// TODO: scripts/publish.mjs
