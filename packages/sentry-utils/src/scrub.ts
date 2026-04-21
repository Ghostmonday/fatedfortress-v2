/**
 * packages/sentry-utils/src/scrub.ts
 *
 * Shared Sentry beforeSend scrubber used by all three zones (SPA, vault worker, edge relay).
 * Prevents Ed25519 private keys, OpenAI-style API keys, JWTs, and credential patterns from
 * being exfiltrated to Sentry in breadcrumbs, stacktrace frame vars, or request bodies.
 *
 * Import this in every Sentry.init() call as beforeSend: scrubEvent.
 */

// @sentry/browser and @sentry/cloudflare share the same Event type shape.
// We use a structural interface so this file has no direct Sentry import
// (avoids bundling Sentry into this utility package).
export interface SentryEvent {
  breadcrumbs?: {
    values?: Array<{
      message?: string;
      data?: Record<string, unknown>;
    }>;
  };
  exception?: {
    values?: Array<{
      stacktrace?: {
        frames?: Array<{
          vars?: Record<string, unknown>;
        }>;
      };
    }>;
  };
  request?: {
    data?: unknown;
  };
}

/**
 * Patterns that match secrets we must never send to Sentry.
 *
 * Note: each regex uses the `g` flag — reset lastIndex between uses via reduce,
 * which creates a new string each iteration.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,                              // OpenAI / Anthropic-style keys
  /[a-f0-9]{64}/g,                                      // 32-byte hex (Ed25519 raw private key)
  /[A-Za-z0-9+/]{43}={0,2}/g,                          // base64-encoded 32-byte value
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,       // JWTs (header.payload...)
  /credential["']?\s*[:=]\s*["']?[^\s"',}\]]{8,}/gi,   // credential=... / credential: "..."
];

export function redactString(s: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (acc, re) => acc.replace(re, "[REDACTED]"),
    s
  );
}

function redactUnknown(v: unknown): unknown {
  return typeof v === "string" ? redactString(v) : v;
}

/**
 * Sentry beforeSend hook — scrubs breadcrumbs, stacktrace frame vars, and
 * request body before the event leaves the browser / worker.
 *
 * Returns null only if the event itself is somehow falsy (should never happen).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubEvent(event: any): any {
  if (!event) return null;

  // ── Breadcrumbs ──────────────────────────────────────────────────────────
  if (event.breadcrumbs?.values) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((bc: typeof event.breadcrumbs.values[number]) => {
      if (bc.message) bc.message = redactString(bc.message);
      if (bc.data) {
        bc.data = Object.fromEntries(
          Object.entries(bc.data).map(([k, v]) => [k, redactUnknown(v)])
        );
      }
      return bc;
    });
  }

  // ── Exception stacktrace frame vars ──────────────────────────────────────
  // The JS SDK can capture local variable values in frames. Wipe them entirely
  // rather than trying to pattern-match — variable names in keystore/budget are
  // meaningful but their values must never leave the vault.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.stacktrace?.frames) {
        for (const frame of ex.stacktrace.frames) {
          if (frame.vars) {
            // Replace every value with [SCRUBBED] — keys (function/variable names) are fine.
            frame.vars = Object.fromEntries(
              Object.keys(frame.vars).map((k) => [k, "[SCRUBBED]"])
            );
          }
        }
      }
    }
  }

  // ── Request body ─────────────────────────────────────────────────────────
  if (event.request?.data !== undefined) {
    if (typeof event.request.data === "string") {
      event.request.data = redactString(event.request.data);
    } else {
      // Drop non-string request bodies entirely rather than risk partial leaks.
      event.request.data = "[SCRUBBED]";
    }
  }

  return event;
}
